//! Hashing benchmark adapter.
//!
//! Benchmarks BLAKE3, SHA-256, and checksum verification throughput
//! without modifying any existing crypto logic.

use crate::{BenchmarkResult, StandardMetrics};
use async_trait::async_trait;
use std::time::Instant;

/// Hash algorithm to benchmark.
#[derive(Debug, Clone, Copy)]
pub enum HashType {
    Blake3,
    Sha256,
    Checksum,
}

/// Hashing benchmark measuring hash computation throughput.
pub struct HashingBenchmark {
    data_size: usize,
    id: String,
    hash_type: HashType,
    iterations: usize,
}

impl HashingBenchmark {
    /// Creates a BLAKE3 benchmark.
    #[must_use]
    pub fn blake3(data_size: usize, id: impl Into<String>) -> Self {
        Self {
            data_size,
            id: id.into(),
            hash_type: HashType::Blake3,
            iterations: 1000,
        }
    }

    /// Creates a SHA-256 benchmark.
    #[must_use]
    pub fn sha256(data_size: usize, id: impl Into<String>) -> Self {
        Self {
            data_size,
            id: id.into(),
            hash_type: HashType::Sha256,
            iterations: 1000,
        }
    }

    /// Creates a checksum verification benchmark.
    #[must_use]
    pub fn checksum(data_size: usize, id: impl Into<String>) -> Self {
        Self {
            data_size,
            id: id.into(),
            hash_type: HashType::Checksum,
            iterations: 1000,
        }
    }

    /// Sets the number of iterations.
    #[must_use]
    pub fn with_iterations(mut self, iterations: usize) -> Self {
        self.iterations = iterations;
        self
    }
}

#[async_trait]
impl super::BenchTarget for HashingBenchmark {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        match self.hash_type {
            HashType::Blake3 => "BLAKE3 Hashing",
            HashType::Sha256 => "SHA-256 Hashing",
            HashType::Checksum => "Checksum Verification",
        }
    }

    fn description(&self) -> &str {
        match self.hash_type {
            HashType::Blake3 => "Measures BLAKE3 hashing throughput",
            HashType::Sha256 => "Measures SHA-256 hashing throughput",
            HashType::Checksum => "Measures checksum computation and verification",
        }
    }

    async fn run(&self) -> BenchmarkResult {
        use vault_crypto::{blake3, sha256, Checksum, HashAlgorithm};

        // Generate test data
        let data: Vec<u8> = (0..self.data_size).map(|i| (i % 256) as u8).collect();

        let mut times = Vec::with_capacity(self.iterations);

        match self.hash_type {
            HashType::Blake3 => {
                for _ in 0..self.iterations {
                    let start = Instant::now();
                    let _hash = blake3(&data);
                    times.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
            HashType::Sha256 => {
                for _ in 0..self.iterations {
                    let start = Instant::now();
                    let _hash = sha256(&data);
                    times.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
            HashType::Checksum => {
                // Pre-compute checksum for verification
                let checksum = Checksum::compute(HashAlgorithm::Blake3, &data);

                for _ in 0..self.iterations {
                    let start = Instant::now();
                    let _valid = checksum.verify(&data);
                    times.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
        }

        // Calculate statistics
        let avg_ms = times.iter().sum::<f64>() / self.iterations as f64;
        let throughput_bps = (self.data_size as f64 / avg_ms) * 1000.0;
        let ops_per_second = 1000.0 / avg_ms;

        // Sort for percentiles
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let p50_idx = self.iterations / 2;
        let p95_idx = (self.iterations as f64 * 0.95) as usize;
        let p99_idx = (self.iterations as f64 * 0.99) as usize;

        let algorithm = match self.hash_type {
            HashType::Blake3 => "BLAKE3",
            HashType::Sha256 => "SHA-256",
            HashType::Checksum => "BLAKE3-Checksum",
        };

        let metrics = StandardMetrics::new()
            .with_duration_ms(avg_ms)
            .with_data_size(self.data_size as u64)
            .with_iterations(self.iterations as u64)
            .with_bytes_per_second(throughput_bps)
            .with_ops_per_second(ops_per_second)
            .with_latencies(
                times[p50_idx],
                times[p95_idx.min(self.iterations - 1)],
                times[p99_idx.min(self.iterations - 1)],
            )
            .with_custom("algorithm", algorithm)
            .with_custom("throughput_bps", throughput_bps);

        BenchmarkResult::new(&self.id, metrics.to_json_value())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::BenchTarget;

    #[tokio::test]
    async fn test_blake3_benchmark() {
        let benchmark = HashingBenchmark::blake3(1024, "test-blake3")
            .with_iterations(10);

        let result = benchmark.run().await;

        assert_eq!(result.target_id, "test-blake3");
        assert!(result.metrics["throughput_bps"].as_f64().unwrap() > 0.0);
    }

    #[tokio::test]
    async fn test_sha256_benchmark() {
        let benchmark = HashingBenchmark::sha256(1024, "test-sha256")
            .with_iterations(10);

        let result = benchmark.run().await;

        assert_eq!(result.target_id, "test-sha256");
        assert!(result.metrics["algorithm"].as_str().unwrap() == "SHA-256");
    }

    #[tokio::test]
    async fn test_checksum_benchmark() {
        let benchmark = HashingBenchmark::checksum(1024, "test-checksum")
            .with_iterations(10);

        let result = benchmark.run().await;

        assert_eq!(result.target_id, "test-checksum");
        assert!(result.metrics["ops_per_second"].as_f64().unwrap() > 0.0);
    }
}
