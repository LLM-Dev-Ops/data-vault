//! Canonical benchmark result types.
//!
//! This module defines the standardized `BenchmarkResult` struct used across
//! all benchmark-target repositories.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Canonical benchmark result structure.
///
/// This struct contains exactly the fields required by the canonical benchmark interface:
/// - `target_id`: Unique identifier for the benchmark target
/// - `metrics`: JSON object containing benchmark measurements
/// - `timestamp`: UTC timestamp when the benchmark was executed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    /// Unique identifier for the benchmark target.
    pub target_id: String,
    /// Metrics collected during benchmark execution.
    pub metrics: serde_json::Value,
    /// Timestamp when the benchmark was executed.
    pub timestamp: DateTime<Utc>,
}

impl BenchmarkResult {
    /// Creates a new benchmark result.
    #[must_use]
    pub fn new(target_id: impl Into<String>, metrics: serde_json::Value) -> Self {
        Self {
            target_id: target_id.into(),
            metrics,
            timestamp: Utc::now(),
        }
    }

    /// Creates a benchmark result with custom timestamp.
    #[must_use]
    pub fn with_timestamp(
        target_id: impl Into<String>,
        metrics: serde_json::Value,
        timestamp: DateTime<Utc>,
    ) -> Self {
        Self {
            target_id: target_id.into(),
            metrics,
            timestamp,
        }
    }

    /// Returns the target ID.
    #[must_use]
    pub fn target_id(&self) -> &str {
        &self.target_id
    }

    /// Returns the metrics.
    #[must_use]
    pub fn metrics(&self) -> &serde_json::Value {
        &self.metrics
    }

    /// Returns the timestamp.
    #[must_use]
    pub fn timestamp(&self) -> DateTime<Utc> {
        self.timestamp
    }

    /// Converts the result to a JSON string.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Parses a benchmark result from JSON.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// Standard metrics commonly used in benchmarks.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StandardMetrics {
    /// Duration in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    /// Throughput in operations per second.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ops_per_second: Option<f64>,
    /// Throughput in bytes per second.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_per_second: Option<f64>,
    /// Latency percentiles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_p50_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_p95_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_p99_ms: Option<f64>,
    /// Memory usage in bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_bytes: Option<u64>,
    /// Number of iterations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iterations: Option<u64>,
    /// Data size in bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_size_bytes: Option<u64>,
    /// Success rate (0.0 to 1.0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success_rate: Option<f64>,
    /// Additional custom metrics.
    #[serde(flatten)]
    pub custom: serde_json::Map<String, serde_json::Value>,
}

impl StandardMetrics {
    /// Creates new empty metrics.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the duration.
    #[must_use]
    pub fn with_duration_ms(mut self, duration_ms: f64) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }

    /// Sets the throughput in operations per second.
    #[must_use]
    pub fn with_ops_per_second(mut self, ops: f64) -> Self {
        self.ops_per_second = Some(ops);
        self
    }

    /// Sets the throughput in bytes per second.
    #[must_use]
    pub fn with_bytes_per_second(mut self, bps: f64) -> Self {
        self.bytes_per_second = Some(bps);
        self
    }

    /// Sets latency percentiles.
    #[must_use]
    pub fn with_latencies(mut self, p50: f64, p95: f64, p99: f64) -> Self {
        self.latency_p50_ms = Some(p50);
        self.latency_p95_ms = Some(p95);
        self.latency_p99_ms = Some(p99);
        self
    }

    /// Sets the data size.
    #[must_use]
    pub fn with_data_size(mut self, bytes: u64) -> Self {
        self.data_size_bytes = Some(bytes);
        self
    }

    /// Sets the number of iterations.
    #[must_use]
    pub fn with_iterations(mut self, iterations: u64) -> Self {
        self.iterations = Some(iterations);
        self
    }

    /// Adds a custom metric.
    #[must_use]
    pub fn with_custom(mut self, key: impl Into<String>, value: impl Into<serde_json::Value>) -> Self {
        self.custom.insert(key.into(), value.into());
        self
    }

    /// Converts to JSON value.
    pub fn to_json_value(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_benchmark_result_creation() {
        let metrics = serde_json::json!({
            "duration_ms": 100.5,
            "ops_per_second": 1000.0
        });

        let result = BenchmarkResult::new("test-target", metrics.clone());

        assert_eq!(result.target_id(), "test-target");
        assert_eq!(result.metrics()["duration_ms"], 100.5);
    }

    #[test]
    fn test_standard_metrics() {
        let metrics = StandardMetrics::new()
            .with_duration_ms(50.0)
            .with_ops_per_second(2000.0)
            .with_data_size(1024)
            .with_custom("custom_field", "value");

        let json = metrics.to_json_value();

        assert_eq!(json["duration_ms"], 50.0);
        assert_eq!(json["ops_per_second"], 2000.0);
        assert_eq!(json["data_size_bytes"], 1024);
        assert_eq!(json["custom_field"], "value");
    }

    #[test]
    fn test_json_roundtrip() {
        let result = BenchmarkResult::new(
            "roundtrip-test",
            serde_json::json!({"value": 42}),
        );

        let json = result.to_json().unwrap();
        let parsed = BenchmarkResult::from_json(&json).unwrap();

        assert_eq!(parsed.target_id(), result.target_id());
        assert_eq!(parsed.metrics()["value"], 42);
    }
}
