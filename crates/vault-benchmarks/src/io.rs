//! Benchmark I/O utilities.
//!
//! This module provides utilities for reading and writing benchmark results
//! to the canonical output directories.

use crate::BenchmarkResult;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Default output directory for benchmark results.
pub const DEFAULT_OUTPUT_DIR: &str = "benchmarks/output";

/// Raw results subdirectory.
pub const RAW_OUTPUT_DIR: &str = "benchmarks/output/raw";

/// Summary file name.
pub const SUMMARY_FILE: &str = "summary.md";

/// Benchmark I/O handler.
pub struct BenchmarkIO {
    output_dir: PathBuf,
    raw_dir: PathBuf,
}

impl BenchmarkIO {
    /// Creates a new I/O handler with default paths.
    #[must_use]
    pub fn new() -> Self {
        Self::with_paths(DEFAULT_OUTPUT_DIR, RAW_OUTPUT_DIR)
    }

    /// Creates an I/O handler with custom paths.
    #[must_use]
    pub fn with_paths(output_dir: impl Into<PathBuf>, raw_dir: impl Into<PathBuf>) -> Self {
        Self {
            output_dir: output_dir.into(),
            raw_dir: raw_dir.into(),
        }
    }

    /// Ensures output directories exist.
    pub fn ensure_directories(&self) -> io::Result<()> {
        fs::create_dir_all(&self.output_dir)?;
        fs::create_dir_all(&self.raw_dir)?;
        Ok(())
    }

    /// Writes a single benchmark result to the raw output directory.
    pub fn write_result(&self, result: &BenchmarkResult) -> io::Result<PathBuf> {
        self.ensure_directories()?;

        let filename = format!(
            "{}_{}.json",
            result.target_id.replace('/', "_").replace(':', "_"),
            result.timestamp.format("%Y%m%d_%H%M%S")
        );
        let path = self.raw_dir.join(&filename);

        let json = result.to_json().map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(&path, json)?;

        Ok(path)
    }

    /// Writes multiple benchmark results to the raw output directory.
    pub fn write_results(&self, results: &[BenchmarkResult]) -> io::Result<Vec<PathBuf>> {
        results.iter().map(|r| self.write_result(r)).collect()
    }

    /// Reads all benchmark results from the raw output directory.
    pub fn read_results(&self) -> io::Result<Vec<BenchmarkResult>> {
        let mut results = Vec::new();

        if !self.raw_dir.exists() {
            return Ok(results);
        }

        for entry in fs::read_dir(&self.raw_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().map_or(false, |ext| ext == "json") {
                let content = fs::read_to_string(&path)?;
                if let Ok(result) = BenchmarkResult::from_json(&content) {
                    results.push(result);
                }
            }
        }

        // Sort by timestamp
        results.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        Ok(results)
    }

    /// Writes a summary file with all results.
    pub fn write_summary(&self, results: &[BenchmarkResult], content: &str) -> io::Result<PathBuf> {
        self.ensure_directories()?;

        let path = self.output_dir.join(SUMMARY_FILE);
        fs::write(&path, content)?;

        // Also write a JSON summary
        let json_path = self.output_dir.join("summary.json");
        let json = serde_json::to_string_pretty(results)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(&json_path, json)?;

        Ok(path)
    }

    /// Returns the output directory path.
    #[must_use]
    pub fn output_dir(&self) -> &Path {
        &self.output_dir
    }

    /// Returns the raw output directory path.
    #[must_use]
    pub fn raw_dir(&self) -> &Path {
        &self.raw_dir
    }

    /// Clears all benchmark results.
    pub fn clear_results(&self) -> io::Result<()> {
        if self.raw_dir.exists() {
            for entry in fs::read_dir(&self.raw_dir)? {
                let entry = entry?;
                if entry.path().extension().map_or(false, |ext| ext == "json") {
                    fs::remove_file(entry.path())?;
                }
            }
        }
        Ok(())
    }
}

impl Default for BenchmarkIO {
    fn default() -> Self {
        Self::new()
    }
}

/// Writes benchmark results to stdout in a human-readable format.
pub fn print_results(results: &[BenchmarkResult]) {
    println!("\n{}", "=".repeat(60));
    println!("BENCHMARK RESULTS");
    println!("{}\n", "=".repeat(60));

    for result in results {
        println!("Target: {}", result.target_id);
        println!("Timestamp: {}", result.timestamp.format("%Y-%m-%d %H:%M:%S UTC"));
        println!("Metrics:");

        if let Some(obj) = result.metrics.as_object() {
            for (key, value) in obj {
                println!("  {}: {}", key, format_value(value));
            }
        }
        println!("{}", "-".repeat(40));
    }
}

/// Formats a JSON value for display.
fn format_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f >= 1_000_000.0 {
                    format!("{:.2}M", f / 1_000_000.0)
                } else if f >= 1_000.0 {
                    format!("{:.2}K", f / 1_000.0)
                } else if f < 1.0 && f > 0.0 {
                    format!("{:.4}", f)
                } else {
                    format!("{:.2}", f)
                }
            } else {
                n.to_string()
            }
        }
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Bool(b) => b.to_string(),
        _ => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_write_read_result() {
        let temp_dir = TempDir::new().unwrap();
        let output_dir = temp_dir.path().join("output");
        let raw_dir = temp_dir.path().join("output/raw");

        let io = BenchmarkIO::with_paths(&output_dir, &raw_dir);

        let result = BenchmarkResult::new(
            "test-target",
            serde_json::json!({"duration_ms": 100.0}),
        );

        let path = io.write_result(&result).unwrap();
        assert!(path.exists());

        let results = io.read_results().unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].target_id, "test-target");
    }

    #[test]
    fn test_format_value() {
        assert_eq!(format_value(&serde_json::json!(1500000.0)), "1.50M");
        assert_eq!(format_value(&serde_json::json!(1500.0)), "1.50K");
        assert_eq!(format_value(&serde_json::json!(0.005)), "0.0050");
        assert_eq!(format_value(&serde_json::json!(42.5)), "42.50");
    }
}
