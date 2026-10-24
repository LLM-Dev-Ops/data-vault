//! Metrics middleware.

use axum::{
    extract::Request,
    middleware::Next,
    response::Response,
};
use metrics::{counter, gauge, histogram};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// Metrics middleware.
#[derive(Clone)]
pub struct MetricsMiddleware {
    /// Active requests counter.
    active_requests: Arc<AtomicU64>,
}

impl MetricsMiddleware {
    /// Creates a new metrics middleware.
    pub fn new() -> Self {
        Self {
            active_requests: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Returns the number of active requests.
    pub fn active_requests(&self) -> u64 {
        self.active_requests.load(Ordering::Relaxed)
    }
}

impl Default for MetricsMiddleware {
    fn default() -> Self {
        Self::new()
    }
}

/// Metrics layer function.
pub async fn metrics_layer(
    middleware: MetricsMiddleware,
    req: Request,
    next: Next,
) -> Response {
    let method = req.method().to_string();
    let path = normalize_path(req.uri().path());

    // Increment active requests
    middleware.active_requests.fetch_add(1, Ordering::Relaxed);
    let active: f64 = middleware.active_requests() as f64;
    gauge!("http_requests_active").set(active);

    let start = Instant::now();

    // Process request
    let response = next.run(req).await;

    // Decrement active requests
    middleware.active_requests.fetch_sub(1, Ordering::Relaxed);
    gauge!("http_requests_active").set(middleware.active_requests() as f64);

    let duration_secs = start.elapsed().as_secs_f64();
    let status = response.status().as_u16().to_string();

    // Record metrics
    counter!(
        "http_requests_total",
        "method" => method.clone(),
        "path" => path.clone(),
        "status" => status.clone()
    )
    .increment(1);

    histogram!(
        "http_request_duration_seconds",
        "method" => method,
        "path" => path,
        "status" => status
    )
    .record(duration_secs);

    response
}

/// Normalizes a path for metrics (removes IDs).
fn normalize_path(path: &str) -> String {
    // Replace UUIDs with placeholder
    let uuid_pattern = regex::Regex::new(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    )
    .unwrap();
    let normalized = uuid_pattern.replace_all(path, "{id}");

    // Replace numeric IDs with placeholder
    let numeric_pattern = regex::Regex::new(r"/\d+(/|$)").unwrap();
    numeric_pattern
        .replace_all(&normalized, "/{id}$1")
        .to_string()
}

/// API metrics collector.
pub struct ApiMetrics {
    /// Total requests.
    pub total_requests: AtomicU64,
    /// Successful requests (2xx).
    pub successful_requests: AtomicU64,
    /// Client errors (4xx).
    pub client_errors: AtomicU64,
    /// Server errors (5xx).
    pub server_errors: AtomicU64,
    /// Active requests.
    pub active_requests: AtomicU64,
}

impl ApiMetrics {
    /// Creates new API metrics.
    pub fn new() -> Self {
        Self {
            total_requests: AtomicU64::new(0),
            successful_requests: AtomicU64::new(0),
            client_errors: AtomicU64::new(0),
            server_errors: AtomicU64::new(0),
            active_requests: AtomicU64::new(0),
        }
    }

    /// Records a request.
    pub fn record_request(&self, status: u16) {
        self.total_requests.fetch_add(1, Ordering::Relaxed);

        match status {
            200..=299 => {
                self.successful_requests.fetch_add(1, Ordering::Relaxed);
            }
            400..=499 => {
                self.client_errors.fetch_add(1, Ordering::Relaxed);
            }
            500..=599 => {
                self.server_errors.fetch_add(1, Ordering::Relaxed);
            }
            _ => {}
        }
    }

    /// Returns a snapshot of metrics.
    pub fn snapshot(&self) -> MetricsSnapshot {
        MetricsSnapshot {
            total_requests: self.total_requests.load(Ordering::Relaxed),
            successful_requests: self.successful_requests.load(Ordering::Relaxed),
            client_errors: self.client_errors.load(Ordering::Relaxed),
            server_errors: self.server_errors.load(Ordering::Relaxed),
            active_requests: self.active_requests.load(Ordering::Relaxed),
        }
    }
}

impl Default for ApiMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Metrics snapshot.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MetricsSnapshot {
    /// Total requests.
    pub total_requests: u64,
    /// Successful requests.
    pub successful_requests: u64,
    /// Client errors.
    pub client_errors: u64,
    /// Server errors.
    pub server_errors: u64,
    /// Active requests.
    pub active_requests: u64,
}

impl MetricsSnapshot {
    /// Returns the success rate (0.0-1.0).
    pub fn success_rate(&self) -> f64 {
        if self.total_requests == 0 {
            return 1.0;
        }
        self.successful_requests as f64 / self.total_requests as f64
    }

    /// Returns the error rate (0.0-1.0).
    pub fn error_rate(&self) -> f64 {
        if self.total_requests == 0 {
            return 0.0;
        }
        (self.client_errors + self.server_errors) as f64 / self.total_requests as f64
    }
}

/// Latency histogram buckets (in seconds).
pub const LATENCY_BUCKETS: [f64; 12] = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0,
];

/// Response size histogram buckets (in bytes).
pub const SIZE_BUCKETS: [f64; 10] = [
    100.0, 1000.0, 10000.0, 100000.0, 1000000.0, 10000000.0,
    100000000.0, 1000000000.0, 10000000000.0, 100000000000.0,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path() {
        assert_eq!(
            normalize_path("/api/v1/datasets/550e8400-e29b-41d4-a716-446655440000"),
            "/api/v1/datasets/{id}"
        );
        assert_eq!(
            normalize_path("/api/v1/users/123"),
            "/api/v1/users/{id}"
        );
        assert_eq!(
            normalize_path("/api/v1/users/123/records"),
            "/api/v1/users/{id}/records"
        );
        assert_eq!(
            normalize_path("/api/v1/datasets/{id}/records"),
            "/api/v1/datasets/{id}/records"
        );
    }

    #[test]
    fn test_api_metrics() {
        let metrics = ApiMetrics::new();

        metrics.record_request(200);
        metrics.record_request(201);
        metrics.record_request(400);
        metrics.record_request(500);

        let snapshot = metrics.snapshot();

        assert_eq!(snapshot.total_requests, 4);
        assert_eq!(snapshot.successful_requests, 2);
        assert_eq!(snapshot.client_errors, 1);
        assert_eq!(snapshot.server_errors, 1);
    }

    #[test]
    fn test_metrics_snapshot_rates() {
        let metrics = ApiMetrics::new();

        for _ in 0..80 {
            metrics.record_request(200);
        }
        for _ in 0..10 {
            metrics.record_request(400);
        }
        for _ in 0..10 {
            metrics.record_request(500);
        }

        let snapshot = metrics.snapshot();

        assert!((snapshot.success_rate() - 0.8).abs() < 0.001);
        assert!((snapshot.error_rate() - 0.2).abs() < 0.001);
    }
}
