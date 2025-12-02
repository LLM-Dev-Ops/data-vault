//! Storage benchmark adapter.
//!
//! Benchmarks content-addressable storage operations including
//! read/write throughput and content addressing without modifying
//! any existing storage logic.

use crate::{BenchmarkResult, StandardMetrics};
use async_trait::async_trait;
use std::sync::Arc;
use std::time::Instant;

/// Storage operation type to benchmark.
#[derive(Debug, Clone, Copy)]
pub enum StorageOperation {
    /// Write operations.
    Write,
    /// Read operations.
    Read,
    /// Content addressing (hash computation).
    ContentAddressing,
}

/// Storage benchmark measuring read/write throughput.
pub struct StorageBenchmark {
    data_size: usize,
    id: String,
    operation: StorageOperation,
    iterations: usize,
}

impl StorageBenchmark {
    /// Creates a write benchmark.
    #[must_use]
    pub fn write(data_size: usize, id: impl Into<String>) -> Self {
        Self {
            data_size,
            id: id.into(),
            operation: StorageOperation::Write,
            iterations: 100,
        }
    }

    /// Creates a read benchmark.
    #[must_use]
    pub fn read(data_size: usize, id: impl Into<String>) -> Self {
        Self {
            data_size,
            id: id.into(),
            operation: StorageOperation::Read,
            iterations: 100,
        }
    }

    /// Creates a content addressing benchmark.
    #[must_use]
    pub fn content_addressing(data_size: usize, id: impl Into<String>) -> Self {
        Self {
            data_size,
            id: id.into(),
            operation: StorageOperation::ContentAddressing,
            iterations: 100,
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
impl super::BenchTarget for StorageBenchmark {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        match self.operation {
            StorageOperation::Write => "Storage Write",
            StorageOperation::Read => "Storage Read",
            StorageOperation::ContentAddressing => "Content Addressing",
        }
    }

    fn description(&self) -> &str {
        match self.operation {
            StorageOperation::Write => "Measures storage write throughput",
            StorageOperation::Read => "Measures storage read throughput",
            StorageOperation::ContentAddressing => "Measures content addressing (hash + store) throughput",
        }
    }

    async fn run(&self) -> BenchmarkResult {
        use vault_storage::{ContentStore, InMemoryBackend, ContentAddress, HashAlgorithm};

        // Create in-memory backend for benchmarking
        let backend = Arc::new(InMemoryBackend::new());
        let store = ContentStore::new(backend);

        // Generate test data
        let data: Vec<u8> = (0..self.data_size).map(|i| (i % 256) as u8).collect();

        let mut times = Vec::with_capacity(self.iterations);

        match self.operation {
            StorageOperation::Write => {
                for i in 0..self.iterations {
                    // Generate unique data for each iteration to avoid deduplication
                    let mut unique_data = data.clone();
                    unique_data[0] = (i % 256) as u8;
                    if self.data_size > 1 {
                        unique_data[1] = ((i / 256) % 256) as u8;
                    }

                    let start = Instant::now();
                    let _metadata = store.put(&unique_data).await.expect("Write failed");
                    times.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
            StorageOperation::Read => {
                // First, write data to read back
                let metadata = store.put(&data).await.expect("Initial write failed");

                for _ in 0..self.iterations {
                    let start = Instant::now();
                    let _content = store.get(&metadata.address).await.expect("Read failed");
                    times.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
            StorageOperation::ContentAddressing => {
                for i in 0..self.iterations {
                    // Generate unique data
                    let mut unique_data = data.clone();
                    unique_data[0] = (i % 256) as u8;
                    if self.data_size > 1 {
                        unique_data[1] = ((i / 256) % 256) as u8;
                    }

                    let start = Instant::now();
                    // Compute content address (hash)
                    let _address = ContentAddress::from_data(HashAlgorithm::Blake3, &unique_data);
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

        let operation_name = match self.operation {
            StorageOperation::Write => "write",
            StorageOperation::Read => "read",
            StorageOperation::ContentAddressing => "content_addressing",
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
            .with_custom("operation", operation_name)
            .with_custom("throughput_bps", throughput_bps)
            .with_custom("backend", "in-memory");

        BenchmarkResult::new(&self.id, metrics.to_json_value())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::BenchTarget;

    #[tokio::test]
    async fn test_write_benchmark() {
        let benchmark = StorageBenchmark::write(1024, "test-write")
            .with_iterations(10);

        let result = benchmark.run().await;

        assert_eq!(result.target_id, "test-write");
        assert!(result.metrics["throughput_bps"].as_f64().unwrap() > 0.0);
    }

    #[tokio::test]
    async fn test_read_benchmark() {
        let benchmark = StorageBenchmark::read(1024, "test-read")
            .with_iterations(10);

        let result = benchmark.run().await;

        assert_eq!(result.target_id, "test-read");
        assert!(result.metrics["operation"].as_str().unwrap() == "read");
    }

    #[tokio::test]
    async fn test_content_addressing_benchmark() {
        let benchmark = StorageBenchmark::content_addressing(1024, "test-content-addr")
            .with_iterations(10);

        let result = benchmark.run().await;

        assert_eq!(result.target_id, "test-content-addr");
        assert!(result.metrics["ops_per_second"].as_f64().unwrap() > 0.0);
    }
}
