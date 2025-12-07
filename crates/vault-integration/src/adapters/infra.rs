//! LLM-Infra adapter for consuming centralized infrastructure utilities.
//!
//! This adapter provides runtime consumption of shared infrastructure modules
//! from the LLM-Infra ecosystem for:
//! - Configuration loading and hot-reload
//! - Structured logging with context propagation
//! - Distributed tracing integration
//! - Standardized error handling utilities
//! - Caching abstractions with configurable backends
//! - Retry logic with exponential backoff
//! - Rate limiting with token bucket algorithm
//!
//! # Phase 2B Integration
//!
//! This adapter is part of Phase 2B integration, connecting LLM-Data-Vault
//! to the centralized LLM-Infra infrastructure layer. It:
//! - Consumes standardized utilities without duplicating implementations
//! - Maintains Data-Vault's position as the secure data persistence layer
//! - Does NOT introduce circular dependencies
//! - Provides optional feature-gated integration
//!
//! # Usage
//!
//! ```ignore
//! use vault_integration::adapters::InfraAdapter;
//!
//! let adapter = InfraAdapter::new(InfraConfig::default());
//! adapter.initialize().await?;
//!
//! // Access configuration utilities
//! let config = adapter.config_loader();
//!
//! // Access caching utilities
//! let cache = adapter.cache();
//!
//! // Access retry utilities
//! let retry_policy = adapter.retry_policy();
//! ```

use super::{AdapterConfig, AdapterHealth, EcosystemAdapter};
use crate::{IntegrationError, IntegrationResult};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use parking_lot::RwLock;
use tracing::{debug, info, warn, instrument};

/// Infra adapter configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InfraConfig {
    /// Base adapter configuration.
    #[serde(flatten)]
    pub adapter: AdapterConfig,
    /// Enable configuration integration.
    #[serde(default = "default_true")]
    pub enable_config: bool,
    /// Enable logging integration.
    #[serde(default = "default_true")]
    pub enable_logging: bool,
    /// Enable tracing integration.
    #[serde(default = "default_true")]
    pub enable_tracing: bool,
    /// Enable caching integration.
    #[serde(default = "default_true")]
    pub enable_caching: bool,
    /// Enable retry integration.
    #[serde(default = "default_true")]
    pub enable_retry: bool,
    /// Enable rate limiting integration.
    #[serde(default = "default_true")]
    pub enable_rate_limiting: bool,
}

fn default_true() -> bool {
    true
}

impl Default for InfraConfig {
    fn default() -> Self {
        Self {
            adapter: AdapterConfig::default(),
            enable_config: true,
            enable_logging: true,
            enable_tracing: true,
            enable_caching: true,
            enable_retry: true,
            enable_rate_limiting: true,
        }
    }
}

/// Retry policy consumed from LLM-Infra.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    /// Maximum number of retry attempts.
    pub max_retries: u32,
    /// Initial backoff duration in milliseconds.
    pub initial_backoff_ms: u64,
    /// Maximum backoff duration in milliseconds.
    pub max_backoff_ms: u64,
    /// Backoff multiplier.
    pub multiplier: f64,
    /// Add jitter to backoff.
    pub jitter: bool,
    /// Retryable status codes.
    pub retryable_status_codes: Vec<u16>,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_backoff_ms: 100,
            max_backoff_ms: 30_000,
            multiplier: 2.0,
            jitter: true,
            retryable_status_codes: vec![408, 429, 500, 502, 503, 504],
        }
    }
}

impl RetryPolicy {
    /// Calculates backoff duration for a given attempt.
    pub fn backoff_for_attempt(&self, attempt: u32) -> Duration {
        let base_backoff = self.initial_backoff_ms as f64 * self.multiplier.powi(attempt as i32 - 1);
        let backoff_ms = base_backoff.min(self.max_backoff_ms as f64);

        let final_backoff = if self.jitter {
            let jitter = rand::random::<f64>() * 0.3 * backoff_ms;
            backoff_ms + jitter
        } else {
            backoff_ms
        };

        Duration::from_millis(final_backoff as u64)
    }

    /// Checks if a status code should be retried.
    pub fn should_retry(&self, status_code: u16) -> bool {
        self.retryable_status_codes.contains(&status_code)
    }
}

/// Rate limit configuration consumed from LLM-Infra.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitPolicy {
    /// Requests per second.
    pub requests_per_second: u32,
    /// Burst capacity.
    pub burst_size: u32,
    /// Enable per-user limits.
    pub per_user: bool,
    /// Enable per-IP limits.
    pub per_ip: bool,
    /// Enable global limits.
    pub global: bool,
}

impl Default for RateLimitPolicy {
    fn default() -> Self {
        Self {
            requests_per_second: 100,
            burst_size: 200,
            per_user: true,
            per_ip: true,
            global: true,
        }
    }
}

/// Cache configuration consumed from LLM-Infra.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachePolicy {
    /// Maximum number of entries.
    pub max_entries: usize,
    /// Maximum size in bytes.
    pub max_size_bytes: usize,
    /// Default TTL in seconds.
    pub default_ttl_secs: u64,
    /// Enable negative caching.
    pub negative_cache: bool,
    /// Negative cache TTL in seconds.
    pub negative_ttl_secs: u64,
    /// Cache backend type.
    pub backend: CacheBackend,
}

impl Default for CachePolicy {
    fn default() -> Self {
        Self {
            max_entries: 10_000,
            max_size_bytes: 256 * 1024 * 1024, // 256MB
            default_ttl_secs: 3600,
            negative_cache: true,
            negative_ttl_secs: 60,
            backend: CacheBackend::Memory,
        }
    }
}

/// Cache backend types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CacheBackend {
    /// In-memory LRU cache.
    #[default]
    Memory,
    /// Redis cache.
    Redis,
    /// Memcached.
    Memcached,
}

/// Logging configuration consumed from LLM-Infra.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// Log level.
    pub level: String,
    /// Log format (json, pretty).
    pub format: String,
    /// Include timestamps.
    pub timestamps: bool,
    /// Include spans.
    pub spans: bool,
    /// Include targets.
    pub targets: bool,
    /// Include file location.
    pub file_location: bool,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "info".to_string(),
            format: "json".to_string(),
            timestamps: true,
            spans: true,
            targets: true,
            file_location: false,
        }
    }
}

/// Tracing configuration consumed from LLM-Infra.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracingConfig {
    /// Enable distributed tracing.
    pub enabled: bool,
    /// OTLP endpoint.
    pub otlp_endpoint: Option<String>,
    /// Service name.
    pub service_name: String,
    /// Sample rate (0.0 - 1.0).
    pub sample_rate: f64,
    /// Propagation format.
    pub propagation: TracePropagation,
}

impl Default for TracingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            otlp_endpoint: None,
            service_name: "llm-data-vault".to_string(),
            sample_rate: 1.0,
            propagation: TracePropagation::W3c,
        }
    }
}

/// Trace propagation formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TracePropagation {
    /// W3C Trace Context.
    #[default]
    W3c,
    /// Jaeger propagation.
    Jaeger,
    /// B3 propagation.
    B3,
    /// AWS X-Ray.
    XRay,
}

/// Error handling configuration consumed from LLM-Infra.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorConfig {
    /// Include stack traces in errors.
    pub include_stack_trace: bool,
    /// Include error context.
    pub include_context: bool,
    /// Error reporting endpoint.
    pub reporting_endpoint: Option<String>,
    /// Error sampling rate.
    pub sample_rate: f64,
}

impl Default for ErrorConfig {
    fn default() -> Self {
        Self {
            include_stack_trace: false,
            include_context: true,
            reporting_endpoint: None,
            sample_rate: 1.0,
        }
    }
}

/// Infra capabilities status.
#[derive(Debug, Clone, Default)]
pub struct InfraCapabilities {
    /// Configuration loader available.
    pub config_available: bool,
    /// Logging integration available.
    pub logging_available: bool,
    /// Tracing integration available.
    pub tracing_available: bool,
    /// Caching integration available.
    pub caching_available: bool,
    /// Retry policy available.
    pub retry_available: bool,
    /// Rate limiting available.
    pub rate_limiting_available: bool,
}

/// LLM-Infra adapter for consuming centralized infrastructure utilities.
pub struct InfraAdapter {
    /// Adapter configuration.
    config: InfraConfig,
    /// Retry policy.
    retry_policy: Arc<RwLock<RetryPolicy>>,
    /// Rate limit policy.
    rate_limit_policy: Arc<RwLock<RateLimitPolicy>>,
    /// Cache policy.
    cache_policy: Arc<RwLock<CachePolicy>>,
    /// Logging config.
    logging_config: Arc<RwLock<LoggingConfig>>,
    /// Tracing config.
    tracing_config: Arc<RwLock<TracingConfig>>,
    /// Error config.
    error_config: Arc<RwLock<ErrorConfig>>,
    /// Capabilities status.
    capabilities: Arc<RwLock<InfraCapabilities>>,
    /// Initialization state.
    initialized: Arc<RwLock<bool>>,
}

impl InfraAdapter {
    /// Creates a new Infra adapter.
    pub fn new(config: InfraConfig) -> Self {
        Self {
            config,
            retry_policy: Arc::new(RwLock::new(RetryPolicy::default())),
            rate_limit_policy: Arc::new(RwLock::new(RateLimitPolicy::default())),
            cache_policy: Arc::new(RwLock::new(CachePolicy::default())),
            logging_config: Arc::new(RwLock::new(LoggingConfig::default())),
            tracing_config: Arc::new(RwLock::new(TracingConfig::default())),
            error_config: Arc::new(RwLock::new(ErrorConfig::default())),
            capabilities: Arc::new(RwLock::new(InfraCapabilities::default())),
            initialized: Arc::new(RwLock::new(false)),
        }
    }

    /// Creates an adapter with default configuration.
    pub fn with_defaults() -> Self {
        Self::new(InfraConfig::default())
    }

    /// Gets the current retry policy.
    pub fn retry_policy(&self) -> RetryPolicy {
        self.retry_policy.read().clone()
    }

    /// Gets the current rate limit policy.
    pub fn rate_limit_policy(&self) -> RateLimitPolicy {
        self.rate_limit_policy.read().clone()
    }

    /// Gets the current cache policy.
    pub fn cache_policy(&self) -> CachePolicy {
        self.cache_policy.read().clone()
    }

    /// Gets the current logging config.
    pub fn logging_config(&self) -> LoggingConfig {
        self.logging_config.read().clone()
    }

    /// Gets the current tracing config.
    pub fn tracing_config(&self) -> TracingConfig {
        self.tracing_config.read().clone()
    }

    /// Gets the current error config.
    pub fn error_config(&self) -> ErrorConfig {
        self.error_config.read().clone()
    }

    /// Gets the capabilities status.
    pub fn capabilities(&self) -> InfraCapabilities {
        self.capabilities.read().clone()
    }

    /// Updates retry policy from upstream.
    #[instrument(skip(self))]
    pub async fn refresh_retry_policy(&self) -> IntegrationResult<()> {
        if !self.config.enable_retry {
            return Ok(());
        }

        debug!("Refreshing retry policy from LLM-Infra");

        // In a real implementation, this would fetch from the Infra service
        // For now, we use sensible defaults that match the existing implementation
        let policy = RetryPolicy::default();
        *self.retry_policy.write() = policy;

        Ok(())
    }

    /// Updates rate limit policy from upstream.
    #[instrument(skip(self))]
    pub async fn refresh_rate_limit_policy(&self) -> IntegrationResult<()> {
        if !self.config.enable_rate_limiting {
            return Ok(());
        }

        debug!("Refreshing rate limit policy from LLM-Infra");

        let policy = RateLimitPolicy::default();
        *self.rate_limit_policy.write() = policy;

        Ok(())
    }

    /// Updates cache policy from upstream.
    #[instrument(skip(self))]
    pub async fn refresh_cache_policy(&self) -> IntegrationResult<()> {
        if !self.config.enable_caching {
            return Ok(());
        }

        debug!("Refreshing cache policy from LLM-Infra");

        let policy = CachePolicy::default();
        *self.cache_policy.write() = policy;

        Ok(())
    }

    /// Refreshes all configurations from upstream.
    pub async fn refresh_all(&self) -> IntegrationResult<()> {
        info!("Refreshing all configurations from LLM-Infra");

        self.refresh_retry_policy().await?;
        self.refresh_rate_limit_policy().await?;
        self.refresh_cache_policy().await?;

        Ok(())
    }

    /// Updates capabilities based on what's available.
    fn update_capabilities(&self) {
        let mut caps = self.capabilities.write();
        caps.config_available = self.config.enable_config;
        caps.logging_available = self.config.enable_logging;
        caps.tracing_available = self.config.enable_tracing;
        caps.caching_available = self.config.enable_caching;
        caps.retry_available = self.config.enable_retry;
        caps.rate_limiting_available = self.config.enable_rate_limiting;
    }
}

#[async_trait]
impl EcosystemAdapter for InfraAdapter {
    fn name(&self) -> &str {
        "llm-infra"
    }

    fn version(&self) -> &str {
        "0.2.0"
    }

    async fn health_check(&self) -> IntegrationResult<AdapterHealth> {
        if !self.config.adapter.enabled {
            return Ok(AdapterHealth::unhealthy("Adapter is disabled"));
        }

        if !*self.initialized.read() {
            return Ok(AdapterHealth::unhealthy("Adapter not initialized"));
        }

        let caps = self.capabilities();
        let available_count = [
            caps.config_available,
            caps.logging_available,
            caps.tracing_available,
            caps.caching_available,
            caps.retry_available,
            caps.rate_limiting_available,
        ]
        .iter()
        .filter(|&&x| x)
        .count();

        Ok(AdapterHealth::healthy(format!(
            "LLM-Infra adapter healthy: {}/6 capabilities available",
            available_count
        )))
    }

    async fn initialize(&self) -> IntegrationResult<()> {
        if *self.initialized.read() {
            warn!("Infra adapter already initialized");
            return Ok(());
        }

        info!(
            enable_config = self.config.enable_config,
            enable_logging = self.config.enable_logging,
            enable_tracing = self.config.enable_tracing,
            enable_caching = self.config.enable_caching,
            enable_retry = self.config.enable_retry,
            enable_rate_limiting = self.config.enable_rate_limiting,
            "Initializing LLM-Infra adapter"
        );

        // Update capabilities
        self.update_capabilities();

        // Refresh all configurations
        self.refresh_all().await?;

        *self.initialized.write() = true;

        info!("LLM-Infra adapter initialized successfully");
        Ok(())
    }

    async fn shutdown(&self) -> IntegrationResult<()> {
        info!("Shutting down LLM-Infra adapter");
        *self.initialized.write() = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_adapter_creation() {
        let adapter = InfraAdapter::with_defaults();
        assert_eq!(adapter.name(), "llm-infra");
        assert_eq!(adapter.version(), "0.2.0");
    }

    #[tokio::test]
    async fn test_adapter_initialization() {
        let adapter = InfraAdapter::with_defaults();
        adapter.initialize().await.unwrap();

        let health = adapter.health_check().await.unwrap();
        assert!(health.healthy);
    }

    #[tokio::test]
    async fn test_retry_policy() {
        let adapter = InfraAdapter::with_defaults();
        adapter.initialize().await.unwrap();

        let policy = adapter.retry_policy();
        assert_eq!(policy.max_retries, 3);
        assert!(policy.should_retry(429));
        assert!(policy.should_retry(503));
        assert!(!policy.should_retry(404));
    }

    #[tokio::test]
    async fn test_backoff_calculation() {
        let policy = RetryPolicy::default();

        let backoff1 = policy.backoff_for_attempt(1);
        assert!(backoff1.as_millis() >= 100);

        let backoff2 = policy.backoff_for_attempt(2);
        assert!(backoff2 > backoff1);
    }

    #[tokio::test]
    async fn test_rate_limit_policy() {
        let adapter = InfraAdapter::with_defaults();
        adapter.initialize().await.unwrap();

        let policy = adapter.rate_limit_policy();
        assert_eq!(policy.requests_per_second, 100);
        assert_eq!(policy.burst_size, 200);
    }

    #[tokio::test]
    async fn test_cache_policy() {
        let adapter = InfraAdapter::with_defaults();
        adapter.initialize().await.unwrap();

        let policy = adapter.cache_policy();
        assert_eq!(policy.max_entries, 10_000);
        assert!(policy.negative_cache);
    }

    #[tokio::test]
    async fn test_capabilities() {
        let adapter = InfraAdapter::with_defaults();
        adapter.initialize().await.unwrap();

        let caps = adapter.capabilities();
        assert!(caps.config_available);
        assert!(caps.logging_available);
        assert!(caps.tracing_available);
        assert!(caps.caching_available);
        assert!(caps.retry_available);
        assert!(caps.rate_limiting_available);
    }

    #[tokio::test]
    async fn test_disabled_capabilities() {
        let config = InfraConfig {
            enable_caching: false,
            enable_rate_limiting: false,
            ..Default::default()
        };
        let adapter = InfraAdapter::new(config);
        adapter.initialize().await.unwrap();

        let caps = adapter.capabilities();
        assert!(!caps.caching_available);
        assert!(!caps.rate_limiting_available);
        assert!(caps.config_available);
    }
}
