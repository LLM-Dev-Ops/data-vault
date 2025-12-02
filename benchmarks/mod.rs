//! Canonical benchmark module for LLM Data Vault.
//!
//! This module serves as the canonical entry point for the benchmark interface,
//! re-exporting from the vault-benchmarks crate.
//!
//! ## Canonical Interface
//!
//! This benchmark suite implements the canonical benchmark interface used across
//! all 25 benchmark-target repositories:
//!
//! - `run_all_benchmarks()` - Returns `Vec<BenchmarkResult>`
//! - `BenchmarkResult` - Contains `target_id`, `metrics`, `timestamp`
//! - `BenchTarget` trait - Implements `id()` and `run()` methods
//! - `all_targets()` - Returns `Vec<Box<dyn BenchTarget>>`
//!
//! ## Usage
//!
//! ```rust,ignore
//! use vault_benchmarks::{run_all_benchmarks, BenchmarkResult};
//!
//! #[tokio::main]
//! async fn main() {
//!     let results: Vec<BenchmarkResult> = run_all_benchmarks().await;
//!     for result in &results {
//!         println!("{}: {:?}", result.target_id, result.metrics);
//!     }
//! }
//! ```

// Re-export from the vault-benchmarks crate
pub use vault_benchmarks::*;
