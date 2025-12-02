//! # Vault Benchmarks
//!
//! Canonical benchmark interface for LLM Data Vault.
//!
//! This crate provides the standardized benchmark infrastructure used across
//! all 25 benchmark-target repositories. It includes:
//!
//! - `BenchmarkResult`: Canonical result struct with `target_id`, `metrics`, and `timestamp`
//! - `BenchTarget` trait: Interface for implementing benchmark targets
//! - Adapters for Data Vault operations (encryption, hashing, anonymization, storage)
//! - I/O utilities for reading/writing results to canonical output directories
//! - Markdown report generation
//!
//! ## Canonical Structure
//!
//! This module follows the canonical benchmark interface:
//! - `benchmarks/mod.rs` - Main module (this file serves that purpose)
//! - `benchmarks/result.rs` - BenchmarkResult struct
//! - `benchmarks/markdown.rs` - Markdown report generation
//! - `benchmarks/io.rs` - I/O utilities
//!
//! ## Usage
//!
//! ```no_run
//! use vault_benchmarks::{run_all_benchmarks, BenchmarkResult};
//!
//! #[tokio::main]
//! async fn main() {
//!     let results = run_all_benchmarks().await;
//!     for result in &results {
//!         println!("{}: {:?}", result.target_id, result.metrics);
//!     }
//! }
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod result;
pub mod markdown;
pub mod io;
pub mod adapters;

pub use result::{BenchmarkResult, StandardMetrics};
pub use markdown::generate_summary;
pub use io::{BenchmarkIO, print_results, DEFAULT_OUTPUT_DIR, RAW_OUTPUT_DIR, SUMMARY_FILE};
pub use adapters::{BenchTarget, all_targets, targets_by_prefix, target_by_id};

/// Runs all registered benchmarks and returns results.
///
/// This is the canonical entrypoint for the benchmark suite, returning
/// `Vec<BenchmarkResult>` as required by the canonical interface.
///
/// # Example
///
/// ```no_run
/// use vault_benchmarks::run_all_benchmarks;
///
/// #[tokio::main]
/// async fn main() {
///     let results = run_all_benchmarks().await;
///     println!("Ran {} benchmarks", results.len());
/// }
/// ```
pub async fn run_all_benchmarks() -> Vec<BenchmarkResult> {
    let targets = all_targets();
    let mut results = Vec::with_capacity(targets.len());

    for target in targets {
        // Setup
        if let Err(e) = target.setup().await {
            eprintln!("Setup failed for {}: {}", target.id(), e);
            continue;
        }

        // Run benchmark
        let result = target.run().await;
        results.push(result);

        // Teardown
        if let Err(e) = target.teardown().await {
            eprintln!("Teardown failed for {}: {}", target.id(), e);
        }
    }

    results
}

/// Runs benchmarks matching the given prefix and returns results.
pub async fn run_benchmarks_by_prefix(prefix: &str) -> Vec<BenchmarkResult> {
    let targets = targets_by_prefix(prefix);
    let mut results = Vec::with_capacity(targets.len());

    for target in targets {
        if let Err(e) = target.setup().await {
            eprintln!("Setup failed for {}: {}", target.id(), e);
            continue;
        }

        let result = target.run().await;
        results.push(result);

        if let Err(e) = target.teardown().await {
            eprintln!("Teardown failed for {}: {}", target.id(), e);
        }
    }

    results
}

/// Runs a single benchmark by ID and returns the result.
pub async fn run_benchmark_by_id(id: &str) -> Option<BenchmarkResult> {
    let target = target_by_id(id)?;

    if let Err(e) = target.setup().await {
        eprintln!("Setup failed for {}: {}", id, e);
        return None;
    }

    let result = target.run().await;

    if let Err(e) = target.teardown().await {
        eprintln!("Teardown failed for {}: {}", id, e);
    }

    Some(result)
}

/// Runs all benchmarks and writes results to canonical output directories.
pub async fn run_and_save_benchmarks() -> std::io::Result<Vec<BenchmarkResult>> {
    let results = run_all_benchmarks().await;

    let io = BenchmarkIO::new();
    io.write_results(&results)?;

    let summary = generate_summary(&results);
    io.write_summary(&results, &summary)?;

    Ok(results)
}

/// Lists all available benchmark target IDs.
pub fn list_benchmark_ids() -> Vec<&'static str> {
    // We need to create the targets to get their IDs
    // Since BenchTarget returns &str, we'll return a static list
    vec![
        "encryption-1kb",
        "encryption-1mb",
        "encryption-10mb",
        "hashing-blake3-1mb",
        "hashing-sha256-1mb",
        "checksum-verification-1mb",
        "anonymization-100-records",
        "anonymization-1000-records",
        "pii-detection-1000-records",
        "storage-write-1mb",
        "storage-read-1mb",
        "content-addressing-1mb",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_run_all_benchmarks() {
        let results = run_all_benchmarks().await;
        assert!(!results.is_empty());

        // Verify all results have required fields
        for result in &results {
            assert!(!result.target_id.is_empty());
            assert!(result.metrics.is_object());
        }
    }

    #[tokio::test]
    async fn test_run_benchmarks_by_prefix() {
        let results = run_benchmarks_by_prefix("encryption").await;
        assert!(!results.is_empty());
        assert!(results.iter().all(|r| r.target_id.starts_with("encryption")));
    }

    #[tokio::test]
    async fn test_run_benchmark_by_id() {
        let result = run_benchmark_by_id("encryption-1kb").await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().target_id, "encryption-1kb");
    }

    #[test]
    fn test_list_benchmark_ids() {
        let ids = list_benchmark_ids();
        assert!(!ids.is_empty());
        assert!(ids.contains(&"encryption-1kb"));
        assert!(ids.contains(&"hashing-blake3-1mb"));
    }
}
