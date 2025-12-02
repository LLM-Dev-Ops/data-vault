//! Anonymization benchmark adapter.
//!
//! Benchmarks PII detection and anonymization pipeline latency
//! without modifying any existing anonymization logic.

use crate::{BenchmarkResult, StandardMetrics};
use async_trait::async_trait;
use std::time::Instant;

/// Benchmark type for anonymization operations.
#[derive(Debug, Clone, Copy)]
pub enum AnonymizationType {
    /// Full anonymization pipeline (detection + anonymization).
    Full,
    /// PII detection only.
    Detection,
    /// JSON anonymization.
    Json,
}

/// Anonymization benchmark measuring PII detection and anonymization throughput.
pub struct AnonymizationBenchmark {
    record_count: usize,
    id: String,
    benchmark_type: AnonymizationType,
    iterations: usize,
}

impl AnonymizationBenchmark {
    /// Creates a full anonymization benchmark.
    #[must_use]
    pub fn new(record_count: usize, id: impl Into<String>) -> Self {
        Self {
            record_count,
            id: id.into(),
            benchmark_type: AnonymizationType::Full,
            iterations: 10,
        }
    }

    /// Creates a PII detection benchmark.
    #[must_use]
    pub fn pii_detection(record_count: usize, id: impl Into<String>) -> Self {
        Self {
            record_count,
            id: id.into(),
            benchmark_type: AnonymizationType::Detection,
            iterations: 10,
        }
    }

    /// Creates a JSON anonymization benchmark.
    #[must_use]
    pub fn json(record_count: usize, id: impl Into<String>) -> Self {
        Self {
            record_count,
            id: id.into(),
            benchmark_type: AnonymizationType::Json,
            iterations: 10,
        }
    }

    /// Sets the number of iterations.
    #[must_use]
    pub fn with_iterations(mut self, iterations: usize) -> Self {
        self.iterations = iterations;
        self
    }

    /// Generates test records with PII data.
    fn generate_test_records(&self) -> Vec<String> {
        (0..self.record_count)
            .map(|i| {
                format!(
                    "Record {}: Contact john.doe{}@example.com or call 555-{:04}-{:04}. \
                     SSN: {:03}-{:02}-{:04}. Address: {} Main St, City, ST {}",
                    i,
                    i,
                    i % 10000,
                    (i + 1234) % 10000,
                    (i % 900) + 100,
                    (i % 90) + 10,
                    (i % 9000) + 1000,
                    (i % 900) + 100,
                    (i % 90000) + 10000
                )
            })
            .collect()
    }

    /// Generates test JSON records with PII data.
    fn generate_test_json_records(&self) -> Vec<serde_json::Value> {
        (0..self.record_count)
            .map(|i| {
                serde_json::json!({
                    "id": i,
                    "user": {
                        "name": format!("John Doe {}", i),
                        "email": format!("john.doe{}@example.com", i),
                        "phone": format!("555-{:04}-{:04}", i % 10000, (i + 1234) % 10000),
                        "ssn": format!("{:03}-{:02}-{:04}", (i % 900) + 100, (i % 90) + 10, (i % 9000) + 1000)
                    },
                    "metadata": {
                        "created_at": "2024-01-01T00:00:00Z",
                        "ip_address": format!("192.168.{}.{}", i % 256, (i + 1) % 256)
                    }
                })
            })
            .collect()
    }
}

#[async_trait]
impl super::BenchTarget for AnonymizationBenchmark {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        match self.benchmark_type {
            AnonymizationType::Full => "Full Anonymization Pipeline",
            AnonymizationType::Detection => "PII Detection",
            AnonymizationType::Json => "JSON Anonymization",
        }
    }

    fn description(&self) -> &str {
        match self.benchmark_type {
            AnonymizationType::Full => "Measures full PII detection and anonymization pipeline latency",
            AnonymizationType::Detection => "Measures PII detection throughput",
            AnonymizationType::Json => "Measures JSON document anonymization throughput",
        }
    }

    async fn run(&self) -> BenchmarkResult {
        use vault_anonymize::{Anonymizer, AnonymizerConfig, PiiDetector, DetectorConfig};

        let mut times = Vec::with_capacity(self.iterations);
        let mut total_pii_found = 0;
        let mut total_anonymized = 0;
        let mut total_bytes: usize = 0;

        match self.benchmark_type {
            AnonymizationType::Full => {
                let records = self.generate_test_records();
                total_bytes = records.iter().map(|r| r.len()).sum();

                let anonymizer = Anonymizer::new(AnonymizerConfig::default());

                for _ in 0..self.iterations {
                    let start = Instant::now();

                    for record in &records {
                        let result = anonymizer.anonymize(record).expect("Anonymization failed");
                        total_pii_found += result.stats.total_pii_found;
                        total_anonymized += result.stats.total_anonymized;
                    }

                    times.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
            AnonymizationType::Detection => {
                let records = self.generate_test_records();
                total_bytes = records.iter().map(|r| r.len()).sum();

                let detector = PiiDetector::with_config(DetectorConfig::default());

                for _ in 0..self.iterations {
                    let start = Instant::now();

                    for record in &records {
                        let detections = detector.detect(record);
                        total_pii_found += detections.len();
                    }

                    times.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
            AnonymizationType::Json => {
                let records = self.generate_test_json_records();
                total_bytes = records
                    .iter()
                    .map(|r| serde_json::to_string(r).unwrap_or_default().len())
                    .sum();

                let anonymizer = Anonymizer::new(AnonymizerConfig::default());

                for _ in 0..self.iterations {
                    let start = Instant::now();

                    for record in &records {
                        let (_, output) = anonymizer.anonymize_json(record).expect("JSON anonymization failed");
                        total_pii_found += output.stats.total_pii_found;
                        total_anonymized += output.stats.total_anonymized;
                    }

                    times.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
        }

        // Calculate statistics
        let avg_ms = times.iter().sum::<f64>() / self.iterations as f64;
        let records_per_second = (self.record_count as f64 / avg_ms) * 1000.0;
        let throughput_bps = (total_bytes as f64 / avg_ms) * 1000.0;

        // Sort for percentiles
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let p50_idx = self.iterations / 2;
        let p95_idx = (self.iterations as f64 * 0.95) as usize;
        let p99_idx = (self.iterations as f64 * 0.99) as usize;

        let avg_pii_per_record = total_pii_found as f64 / (self.record_count * self.iterations) as f64;

        let metrics = StandardMetrics::new()
            .with_duration_ms(avg_ms)
            .with_data_size(total_bytes as u64)
            .with_iterations(self.iterations as u64)
            .with_ops_per_second(records_per_second)
            .with_bytes_per_second(throughput_bps)
            .with_latencies(
                times[p50_idx],
                times[p95_idx.min(self.iterations - 1)],
                times[p99_idx.min(self.iterations - 1)],
            )
            .with_custom("record_count", self.record_count as u64)
            .with_custom("records_per_second", records_per_second)
            .with_custom("avg_pii_per_record", avg_pii_per_record)
            .with_custom("total_pii_found", total_pii_found as u64)
            .with_custom("total_anonymized", total_anonymized as u64);

        BenchmarkResult::new(&self.id, metrics.to_json_value())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::BenchTarget;

    #[tokio::test]
    async fn test_anonymization_benchmark() {
        let benchmark = AnonymizationBenchmark::new(10, "test-anonymization")
            .with_iterations(2);

        let result = benchmark.run().await;

        assert_eq!(result.target_id, "test-anonymization");
        assert!(result.metrics["records_per_second"].as_f64().unwrap() > 0.0);
    }

    #[tokio::test]
    async fn test_pii_detection_benchmark() {
        let benchmark = AnonymizationBenchmark::pii_detection(10, "test-pii-detection")
            .with_iterations(2);

        let result = benchmark.run().await;

        assert_eq!(result.target_id, "test-pii-detection");
        assert!(result.metrics["total_pii_found"].as_u64().unwrap() > 0);
    }
}
