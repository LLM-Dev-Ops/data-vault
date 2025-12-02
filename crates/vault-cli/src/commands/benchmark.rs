//! Benchmark CLI commands.
//!
//! Provides CLI access to the canonical benchmark suite.

use clap::{Args, Subcommand};

use crate::output::{CliError, OutputFormat};

/// Benchmark commands.
#[derive(Args)]
pub struct BenchmarkCommands {
    #[command(subcommand)]
    pub command: BenchmarkSubcommand,
}

/// Benchmark subcommands.
#[derive(Subcommand)]
pub enum BenchmarkSubcommand {
    /// Run benchmarks
    Run(RunBenchmarkCommand),
    /// List available benchmarks
    List(ListBenchmarksCommand),
    /// Show benchmark results
    Results(ResultsCommand),
}

/// Run benchmark command.
#[derive(Args)]
pub struct RunBenchmarkCommand {
    /// Specific benchmark target to run (e.g., "encryption-1kb")
    #[arg(long, short)]
    pub target: Option<String>,

    /// Run all benchmarks matching this prefix (e.g., "encryption")
    #[arg(long, short)]
    pub prefix: Option<String>,

    /// Save results to canonical output directory
    #[arg(long, default_value = "true")]
    pub save: bool,

    /// Output directory for results (default: benchmarks/output)
    #[arg(long)]
    pub output_dir: Option<String>,

    /// Number of iterations for each benchmark
    #[arg(long)]
    pub iterations: Option<usize>,
}

/// List benchmarks command.
#[derive(Args)]
pub struct ListBenchmarksCommand {
    /// Filter by prefix
    #[arg(long, short)]
    pub prefix: Option<String>,
}

/// Show results command.
#[derive(Args)]
pub struct ResultsCommand {
    /// Path to results directory
    #[arg(long)]
    pub path: Option<String>,

    /// Show only the latest results
    #[arg(long)]
    pub latest: bool,

    /// Show detailed metrics
    #[arg(long, short)]
    pub detailed: bool,
}

impl BenchmarkCommands {
    /// Runs the benchmark command.
    pub async fn run(self, format: OutputFormat) -> Result<(), CliError> {
        match self.command {
            BenchmarkSubcommand::Run(cmd) => cmd.run(format).await,
            BenchmarkSubcommand::List(cmd) => cmd.run(format).await,
            BenchmarkSubcommand::Results(cmd) => cmd.run(format).await,
        }
    }
}

impl RunBenchmarkCommand {
    /// Runs benchmarks.
    pub async fn run(self, format: OutputFormat) -> Result<(), CliError> {
        use vault_benchmarks::{
            run_all_benchmarks, run_benchmark_by_id, run_benchmarks_by_prefix,
            BenchmarkIO, generate_summary, print_results,
        };

        println!("Running benchmarks...\n");

        let results = if let Some(target) = &self.target {
            // Run specific benchmark
            match run_benchmark_by_id(target).await {
                Some(result) => vec![result],
                None => {
                    return Err(CliError::validation(format!(
                        "Benchmark target '{}' not found",
                        target
                    )));
                }
            }
        } else if let Some(prefix) = &self.prefix {
            // Run benchmarks by prefix
            let results = run_benchmarks_by_prefix(prefix).await;
            if results.is_empty() {
                return Err(CliError::validation(format!(
                    "No benchmarks found with prefix '{}'",
                    prefix
                )));
            }
            results
        } else {
            // Run all benchmarks
            run_all_benchmarks().await
        };

        // Display results
        match format {
            OutputFormat::Json => {
                let json = serde_json::to_string_pretty(&results)
                    .map_err(|e| CliError::serialization(e.to_string()))?;
                println!("{}", json);
            }
            OutputFormat::Table | OutputFormat::Plain => {
                print_results(&results);
            }
        }

        // Save results if requested
        if self.save {
            let io = if let Some(dir) = &self.output_dir {
                BenchmarkIO::with_paths(dir, format!("{}/raw", dir))
            } else {
                BenchmarkIO::new()
            };

            io.write_results(&results)
                .map_err(|e| CliError::io(e.to_string()))?;

            let summary = generate_summary(&results);
            io.write_summary(&results, &summary)
                .map_err(|e| CliError::io(e.to_string()))?;

            println!(
                "\nResults saved to: {}/",
                io.output_dir().display()
            );
        }

        println!("\nCompleted {} benchmark(s)", results.len());

        Ok(())
    }
}

impl ListBenchmarksCommand {
    /// Lists available benchmarks.
    pub async fn run(self, format: OutputFormat) -> Result<(), CliError> {
        use vault_benchmarks::{all_targets, targets_by_prefix};

        let targets: Vec<_> = if let Some(prefix) = &self.prefix {
            targets_by_prefix(prefix)
        } else {
            all_targets()
        };

        match format {
            OutputFormat::Json => {
                let ids: Vec<&str> = targets.iter().map(|t| t.id()).collect();
                let json = serde_json::to_string_pretty(&ids)
                    .map_err(|e| CliError::serialization(e.to_string()))?;
                println!("{}", json);
            }
            OutputFormat::Table | OutputFormat::Plain => {
                println!("Available Benchmarks:\n");
                println!("{:<35} {}", "ID", "Description");
                println!("{}", "-".repeat(70));

                for target in &targets {
                    println!("{:<35} {}", target.id(), target.description());
                }

                println!("\nTotal: {} benchmark(s)", targets.len());
            }
        }

        Ok(())
    }
}

impl ResultsCommand {
    /// Shows benchmark results.
    pub async fn run(self, format: OutputFormat) -> Result<(), CliError> {
        use vault_benchmarks::{BenchmarkIO, print_results};

        let io = if let Some(path) = &self.path {
            BenchmarkIO::with_paths(path, format!("{}/raw", path))
        } else {
            BenchmarkIO::new()
        };

        let results = io.read_results()
            .map_err(|e| CliError::io(e.to_string()))?;

        if results.is_empty() {
            println!("No benchmark results found.");
            return Ok(());
        }

        let display_results = if self.latest {
            // Group by target_id and get latest
            let mut latest_by_target: std::collections::HashMap<&str, _> = std::collections::HashMap::new();
            for result in &results {
                latest_by_target
                    .entry(result.target_id.as_str())
                    .and_modify(|existing: &mut &vault_benchmarks::BenchmarkResult| {
                        if result.timestamp > existing.timestamp {
                            *existing = result;
                        }
                    })
                    .or_insert(result);
            }
            latest_by_target.values().cloned().cloned().collect()
        } else {
            results
        };

        match format {
            OutputFormat::Json => {
                let json = serde_json::to_string_pretty(&display_results)
                    .map_err(|e| CliError::serialization(e.to_string()))?;
                println!("{}", json);
            }
            OutputFormat::Table | OutputFormat::Plain => {
                print_results(&display_results);
            }
        }

        Ok(())
    }
}
