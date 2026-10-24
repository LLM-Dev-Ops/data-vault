//! Authentication middleware.

use crate::{state::RequestContext, ApiError};
use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;
use tracing::{debug, warn};
use vault_access::{TokenClaims, TokenManager};

/// Authentication middleware.
#[derive(Clone)]
pub struct AuthMiddleware {
    /// Token manager.
    token_manager: Arc<TokenManager>,
    /// Paths to exclude from authentication.
    exclude_paths: Vec<String>,
}

impl AuthMiddleware {
    /// Creates a new auth middleware.
    pub fn new(token_manager: Arc<TokenManager>) -> Self {
        Self {
            token_manager,
            exclude_paths: vec![
                "/health".to_string(),
                "/metrics".to_string(),
                "/api/v1/auth/login".to_string(),
                "/api/v1/auth/register".to_string(),
            ],
        }
    }

    /// Adds paths to exclude from authentication.
    pub fn exclude(mut self, paths: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.exclude_paths.extend(paths.into_iter().map(Into::into));
        self
    }

    /// Checks if a path should skip authentication.
    fn should_skip(&self, path: &str) -> bool {
        self.exclude_paths.iter().any(|p| path.starts_with(p))
    }

    /// Extracts and validates the token from the request.
    fn extract_token(&self, req: &Request) -> Result<Option<TokenClaims>, ApiError> {
        // Check Authorization header
        if let Some(auth_header) = req.headers().get(header::AUTHORIZATION) {
            let auth_str = auth_header
                .to_str()
                .map_err(|_| ApiError::Unauthorized("Invalid authorization header".into()))?;

            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                let claims = self
                    .token_manager
                    .validate(token)
                    .map_err(|e| ApiError::Unauthorized(e.to_string()))?;
                return Ok(Some(claims));
            }
        }

        // Check X-API-Key header
        if let Some(api_key) = req.headers().get("X-API-Key") {
            let key_str = api_key
                .to_str()
                .map_err(|_| ApiError::Unauthorized("Invalid API key header".into()))?;

            // Validate API key (this would check against stored keys)
            // For now, we just validate the format
            if key_str.len() >= 32 {
                // Return minimal claims for API key auth
                // In production, look up the key and return associated claims
                return Ok(Some(
                    TokenClaims::access("api-key-user", "llm-data-vault", 3600)
                        .with_roles(vec!["api-user".to_string()]),
                ));
            }
        }

        Ok(None)
    }
}

/// Authentication layer function.
pub async fn auth_layer(
    State(auth): State<AuthMiddleware>,
    mut req: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let path = req.uri().path().to_string();

    // Skip auth for excluded paths
    if auth.should_skip(&path) {
        return Ok(next.run(req).await);
    }

    // Extract token
    let claims = auth.extract_token(&req)?;

    match claims {
        Some(claims) => {
            debug!(
                user_id = %claims.sub,
                path = %path,
                "Request authenticated"
            );

            // Add claims to request extensions
            req.extensions_mut().insert(claims);

            Ok(next.run(req).await)
        }
        None => {
            warn!(path = %path, "Unauthenticated request");
            Err(ApiError::Unauthorized(
                "Authentication required".to_string(),
            ))
        }
    }
}

/// Extracts authenticated user from request.
pub fn extract_user(req: &Request) -> Option<&TokenClaims> {
    req.extensions().get::<TokenClaims>()
}

/// Requires specific roles.
pub fn require_roles(claims: &TokenClaims, required: &[&str]) -> Result<(), ApiError> {
    for role in required {
        if !claims.roles.iter().any(|r| r == *role) {
            return Err(ApiError::Forbidden(format!(
                "Required role '{}' not found",
                role
            )));
        }
    }
    Ok(())
}

/// Requires any of the specified roles.
pub fn require_any_role(claims: &TokenClaims, roles: &[&str]) -> Result<(), ApiError> {
    for role in roles {
        if claims.roles.iter().any(|r| r == *role) {
            return Ok(());
        }
    }
    Err(ApiError::Forbidden(format!(
        "One of these roles required: {}",
        roles.join(", ")
    )))
}

/// Requires specific permissions.
pub fn require_permissions(claims: &TokenClaims, required: &[&str]) -> Result<(), ApiError> {
    for perm in required {
        if !claims.permissions.iter().any(|p| p == *perm) {
            return Err(ApiError::Forbidden(format!(
                "Required permission '{}' not found",
                perm
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_claims(roles: Vec<&str>, permissions: Vec<&str>) -> TokenClaims {
        let now = chrono::Utc::now().timestamp();

        TokenClaims {
            sub: "user-123".to_string(),
            iss: "llm-data-vault".to_string(),
            aud: None,
            exp: now + 3600,
            iat: now,
            nbf: None,
            jti: uuid::Uuid::new_v4().to_string(),
            token_type: vault_access::token::TokenType::Access,
            roles: roles.into_iter().map(String::from).collect(),
            permissions: permissions.into_iter().map(String::from).collect(),
            tenant_id: None,
            custom: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn test_require_roles_success() {
        let claims = create_claims(vec!["admin", "user"], vec![]);
        assert!(require_roles(&claims, &["admin"]).is_ok());
        assert!(require_roles(&claims, &["user"]).is_ok());
        assert!(require_roles(&claims, &["admin", "user"]).is_ok());
    }

    #[test]
    fn test_require_roles_failure() {
        let claims = create_claims(vec!["user"], vec![]);
        assert!(require_roles(&claims, &["admin"]).is_err());
    }

    #[test]
    fn test_require_any_role() {
        let claims = create_claims(vec!["user"], vec![]);
        assert!(require_any_role(&claims, &["admin", "user"]).is_ok());
        assert!(require_any_role(&claims, &["admin", "superuser"]).is_err());
    }

    #[test]
    fn test_require_permissions() {
        let claims = create_claims(vec![], vec!["read:datasets", "write:datasets"]);
        assert!(require_permissions(&claims, &["read:datasets"]).is_ok());
        assert!(require_permissions(&claims, &["delete:datasets"]).is_err());
    }
}
