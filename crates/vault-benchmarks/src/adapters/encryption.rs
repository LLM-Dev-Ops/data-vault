//! Encryption benchmark adapter.
//!
//! Benchmarks AES-256-GCM encryption and decryption throughput
//! without modifying any existing crypto logic.

use crate::{BenchmarkResult, StandardMetrics};
use async_trait::async_trait;
use std::time::Instant;

/// Encryption benchmark measuring encrypt/decrypt throughput.
pub struct EncryptionBenchmark {
    data_size: usize,
    id: String,
    iterations: usize,
}

impl EncryptionBenchmark {
    /// Creates a new encryption benchmark.
    #[must_use]
    pub fn new(data_size: usize, id: impl Into<String>) -> Self {
        Self {
            data_size,
            id: id.into(),
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
impl super::BenchTarget for EncryptionBenchmark {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        "AES-256-GCM Encryption"
    }

    fn description(&self) -> &str {
        "Measures AES-256-GCM encryption and decryption throughput"
    }

    async fn run(&self) -> BenchmarkResult {
        use vault_crypto::{AesGcmCipher, EncryptionContext};

        // Generate test data
        let data: Vec<u8> = (0..self.data_size).map(|i| (i % 256) as u8).collect();
        let cipher = AesGcmCipher::new();
        let key = cipher.generate_key();

        // Create encryption context for AAD
        let context = EncryptionContext::new()
            .with("benchmark", "true")
            .with("data_size", self.data_size.to_string());
        let aad = context.to_aad();

        // Benchmark encryption
        let mut encrypt_times = Vec::with_capacity(self.iterations);
        let mut decrypt_times = Vec::with_capacity(self.iterations);

        for _ in 0..self.iterations {
            // Encrypt
            let start = Instant::now();
            let encrypted = cipher.encrypt(&key, &data, Some(&aad)).expect("Encryption failed");
            encrypt_times.push(start.elapsed().as_secs_f64() * 1000.0);

            // Decrypt
            let start = Instant::now();
            let _decrypted = cipher.decrypt(&key, &encrypted).expect("Decryption failed");
            decrypt_times.push(start.elapsed().as_secs_f64() * 1000.0);
        }

        // Calculate statistics
        let avg_encrypt_ms = encrypt_times.iter().sum::<f64>() / self.iterations as f64;
        let avg_decrypt_ms = decrypt_times.iter().sum::<f64>() / self.iterations as f64;
        let total_ms = avg_encrypt_ms + avg_decrypt_ms;

        // Calculate throughput (bytes per second)
        let encrypt_throughput = (self.data_size as f64 / avg_encrypt_ms) * 1000.0;
        let decrypt_throughput = (self.data_size as f64 / avg_decrypt_ms) * 1000.0;

        // Sort for percentiles
        encrypt_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        decrypt_times.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let p50_idx = self.iterations / 2;
        let p95_idx = (self.iterations as f64 * 0.95) as usize;
        let p99_idx = (self.iterations as f64 * 0.99) as usize;

        let metrics = StandardMetrics::new()
            .with_duration_ms(total_ms)
            .with_data_size(self.data_size as u64)
            .with_iterations(self.iterations as u64)
            .with_bytes_per_second(encrypt_throughput)
            .with_latencies(
                encrypt_times[p50_idx],
                encrypt_times[p95_idx.min(self.iterations - 1)],
                encrypt_times[p99_idx.min(self.iterations - 1)],
            )
            .with_custom("encrypt_avg_ms", avg_encrypt_ms)
            .with_custom("decrypt_avg_ms", avg_decrypt_ms)
            .with_custom("encrypt_throughput_bps", encrypt_throughput)
            .with_custom("decrypt_throughput_bps", decrypt_throughput)
            .with_custom("algorithm", "AES-256-GCM");

        BenchmarkResult::new(&self.id, metrics.to_json_value())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::BenchTarget;

    #[tokio::test]
    async fn test_encryption_benchmark() {
        let benchmark = EncryptionBenchmark::new(1024, "test-encryption")
            .with_iterations(10);

        let result = benchmark.run().await;

        assert_eq!(result.target_id, "test-encryption");
        assert!(result.metrics["duration_ms"].as_f64().unwrap() > 0.0);
        assert!(result.metrics["encrypt_throughput_bps"].as_f64().unwrap() > 0.0);
    }
}
