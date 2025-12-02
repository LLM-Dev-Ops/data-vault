//! Benchmark adapters implementing the canonical BenchTarget trait.
//!
//! This module provides adapters for Data Vault operations, exposing them
//! as benchmark targets without modifying any existing storage, security,
//! or transformation logic.

mod encryption;
mod hashing;
mod anonymization;
mod storage;

pub use encryption::EncryptionBenchmark;
pub use hashing::HashingBenchmark;
pub use anonymization::AnonymizationBenchmark;
pub use storage::StorageBenchmark;

use crate::BenchmarkResult;
use async_trait::async_trait;

/// Canonical benchmark target trait.
///
/// All benchmark adapters must implement this trait to be compatible
/// with the canonical benchmark interface used across all 25 benchmark-target
/// repositories.
#[async_trait]
pub trait BenchTarget: Send + Sync {
    /// Returns the unique identifier for this benchmark target.
    fn id(&self) -> &str;

    /// Returns a human-readable name for this benchmark.
    fn name(&self) -> &str {
        self.id()
    }

    /// Returns a description of what this benchmark measures.
    fn description(&self) -> &str {
        ""
    }

    /// Runs the benchmark and returns the result.
    async fn run(&self) -> BenchmarkResult;

    /// Performs any necessary setup before running the benchmark.
    async fn setup(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        Ok(())
    }

    /// Performs any necessary cleanup after running the benchmark.
    async fn teardown(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        Ok(())
    }
}

/// Registry of all benchmark targets.
///
/// Returns a vector of all available benchmark targets implementing
/// the canonical BenchTarget trait.
pub fn all_targets() -> Vec<Box<dyn BenchTarget>> {
    vec![
        // Encryption benchmarks
        Box::new(EncryptionBenchmark::new(1024, "encryption-1kb")),
        Box::new(EncryptionBenchmark::new(1024 * 1024, "encryption-1mb")),
        Box::new(EncryptionBenchmark::new(10 * 1024 * 1024, "encryption-10mb")),

        // Hashing benchmarks
        Box::new(HashingBenchmark::blake3(1024 * 1024, "hashing-blake3-1mb")),
        Box::new(HashingBenchmark::sha256(1024 * 1024, "hashing-sha256-1mb")),
        Box::new(HashingBenchmark::checksum(1024 * 1024, "checksum-verification-1mb")),

        // Anonymization benchmarks
        Box::new(AnonymizationBenchmark::new(100, "anonymization-100-records")),
        Box::new(AnonymizationBenchmark::new(1000, "anonymization-1000-records")),
        Box::new(AnonymizationBenchmark::pii_detection(1000, "pii-detection-1000-records")),

        // Storage benchmarks
        Box::new(StorageBenchmark::write(1024 * 1024, "storage-write-1mb")),
        Box::new(StorageBenchmark::read(1024 * 1024, "storage-read-1mb")),
        Box::new(StorageBenchmark::content_addressing(1024 * 1024, "content-addressing-1mb")),
    ]
}

/// Returns targets filtered by ID prefix.
pub fn targets_by_prefix(prefix: &str) -> Vec<Box<dyn BenchTarget>> {
    all_targets()
        .into_iter()
        .filter(|t| t.id().starts_with(prefix))
        .collect()
}

/// Returns a single target by ID.
pub fn target_by_id(id: &str) -> Option<Box<dyn BenchTarget>> {
    all_targets().into_iter().find(|t| t.id() == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_targets_not_empty() {
        let targets = all_targets();
        assert!(!targets.is_empty());
    }

    #[test]
    fn test_targets_have_unique_ids() {
        let targets = all_targets();
        let mut ids: Vec<&str> = targets.iter().map(|t| t.id()).collect();
        let original_len = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), original_len, "Duplicate target IDs found");
    }

    #[test]
    fn test_target_by_prefix() {
        let encryption_targets = targets_by_prefix("encryption");
        assert!(!encryption_targets.is_empty());
        assert!(encryption_targets.iter().all(|t| t.id().starts_with("encryption")));
    }

    #[test]
    fn test_target_by_id() {
        let target = target_by_id("encryption-1kb");
        assert!(target.is_some());
        assert_eq!(target.unwrap().id(), "encryption-1kb");
    }
}
