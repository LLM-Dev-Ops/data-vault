//! CLI command definitions and implementations.

mod auth;
mod datasets;
mod records;
mod pii;
mod webhooks;
mod api_keys;
mod config_cmd;
mod completion;
mod devops;
mod benchmark;

use clap::{Parser, Subcommand};

use crate::config::Config;
use crate::output::{OutputFormat, CliError};

pub use auth::AuthCommands;
pub use datasets::DatasetsCommands;
pub use records::RecordsCommands;
pub use pii::PiiCommands;
pub use webhooks::WebhooksCommands;
pub use api_keys::ApiKeysCommands;
pub use config_cmd::ConfigCommands;
pub use completion::CompletionCommands;
pub use devops::{StatusCommand, ScanCommand, AnonymizeFileCommand, EncryptCommand, DecryptCommand, LineageCommand, AuditLogCommand};
pub use benchmark::BenchmarkCommands;

/// LLM Data Vault CLI
///
/// Enterprise-grade secure storage and anonymization for LLM training data.
#[derive(Parser)]
#[command(name = "vault")]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
#[command(arg_required_else_help = true)]
pub struct Cli {
    /// Vault API base URL
    #[arg(long, env = "VAULT_URL", global = true)]
    pub url: Option<String>,

    /// API key for authentication
    #[arg(long, env = "VAULT_API_KEY", global = true, hide_env_values = true)]
    pub api_key: Option<String>,

    /// Bearer token for authentication
    #[arg(long, env = "VAULT_TOKEN", global = true, hide_env_values = true, conflicts_with = "api_key")]
    pub token: Option<String>,

    /// Output format
    #[arg(long, short, global = true, default_value = "table")]
    pub format: OutputFormat,

    /// Configuration profile to use
    #[arg(long, short = 'P', global = true, default_value = "default")]
    pub profile: String,

    /// Disable colored output
    #[arg(long, global = true)]
    pub no_color: bool,

    /// Enable verbose output
    #[arg(long, short, global = true)]
    pub verbose: bool,

    /// Suppress all output except errors
    #[arg(long, short, global = true)]
    pub quiet: bool,

    #[command(subcommand)]
    pub command: Commands,
}

/// Available commands.
#[derive(Subcommand)]
pub enum Commands {
    // === DevOps Integration Commands ===

    /// Check vault service status and connectivity
    Status(StatusCommand),

    /// Scan files or directories for PII
    Scan(ScanCommand),

    /// Anonymize a file (replaces PII with safe values)
    #[command(name = "anonymize")]
    AnonymizeFile(AnonymizeFileCommand),

    /// Encrypt a file using vault encryption
    Encrypt(EncryptCommand),

    /// Decrypt a file encrypted with vault
    Decrypt(DecryptCommand),

    /// Inspect data lineage for datasets
    Lineage(LineageCommand),

    /// View and query audit logs
    #[command(name = "audit-log", alias = "audit")]
    AuditLog(AuditLogCommand),

    // === Data Management Commands ===

    /// Authentication and session management
    #[command(alias = "login")]
    Auth(AuthCommands),

    /// Manage datasets (add, remove, list, etc.)
    #[command(alias = "ds", alias = "dataset")]
    Datasets(DatasetsCommands),

    /// Manage records within datasets
    #[command(alias = "rec")]
    Records(RecordsCommands),

    /// PII detection and anonymization (interactive)
    Pii(PiiCommands),

    /// Manage webhooks
    #[command(alias = "wh")]
    Webhooks(WebhooksCommands),

    /// Manage API keys
    #[command(alias = "keys")]
    ApiKeys(ApiKeysCommands),

    /// CLI configuration management
    #[command(alias = "cfg")]
    Config(ConfigCommands),

    /// Generate shell completions
    Completion(CompletionCommands),

    /// Check API health (alias for status --detailed)
    Health {
        /// Show detailed component status
        #[arg(long, short)]
        detailed: bool,
    },

    /// Display CLI version and build info
    Version,

    /// Run and manage benchmarks
    #[command(alias = "bench")]
    Benchmark(BenchmarkCommands),
}

impl Cli {
    /// Runs the CLI command.
    pub async fn run(self) -> Result<(), CliError> {
        // Apply color settings
        if self.no_color {
            colored::control::set_override(false);
        }

        // Load configuration
        let config = Config::load(&self.profile)?;

        // Build client configuration
        let client_config = self.build_client_config(&config)?;

        match self.command {
            // DevOps Integration Commands
            Commands::Status(cmd) => cmd.run(&client_config, self.format).await,
            Commands::Scan(cmd) => cmd.run(&client_config, self.format).await,
            Commands::AnonymizeFile(cmd) => cmd.run(&client_config, self.format).await,
            Commands::Encrypt(cmd) => cmd.run(&client_config, self.format).await,
            Commands::Decrypt(cmd) => cmd.run(&client_config, self.format).await,
            Commands::Lineage(cmd) => cmd.run(&client_config, self.format).await,
            Commands::AuditLog(cmd) => cmd.run(&client_config, self.format).await,

            // Data Management Commands
            Commands::Auth(cmd) => cmd.run(&client_config, self.format).await,
            Commands::Datasets(cmd) => cmd.run(&client_config, self.format).await,
            Commands::Records(cmd) => cmd.run(&client_config, self.format).await,
            Commands::Pii(cmd) => cmd.run(&client_config, self.format).await,
            Commands::Webhooks(cmd) => cmd.run(&client_config, self.format).await,
            Commands::ApiKeys(cmd) => cmd.run(&client_config, self.format).await,
            Commands::Config(cmd) => cmd.run(self.format).await,
            Commands::Completion(cmd) => cmd.run(),
            Commands::Health { detailed } => self.health(&client_config, detailed).await,
            Commands::Version => self.version(),
            Commands::Benchmark(cmd) => cmd.run(self.format).await,
        }
    }

    /// Builds the client configuration from CLI args and config file.
    fn build_client_config(&self, config: &Config) -> Result<ClientConfig, CliError> {
        let base_url = self.url.clone()
            .or_else(|| config.url.clone())
            .ok_or_else(|| CliError::config("No API URL configured. Set VAULT_URL or use --url"))?;

        let auth = if let Some(ref key) = self.api_key {
            AuthMethod::ApiKey(key.clone())
        } else if let Some(ref token) = self.token {
            AuthMethod::Token(token.clone())
        } else if let Some(ref key) = config.api_key {
            AuthMethod::ApiKey(key.clone())
        } else if let Some(ref token) = config.token {
            AuthMethod::Token(token.clone())
        } else {
            AuthMethod::None
        };

        Ok(ClientConfig {
            base_url,
            auth,
            timeout_secs: config.timeout_secs.unwrap_or(30),
        })
    }

    /// Checks API health.
    async fn health(&self, config: &ClientConfig, detailed: bool) -> Result<(), CliError> {
        use colored::Colorize;
        use vault_sdk::{VaultClient, ServiceStatus};

        let client = config.build_client()?;
        let health = client.health().check().await?;

        if self.quiet {
            return if health.status == ServiceStatus::Healthy {
                Ok(())
            } else {
                Err(CliError::api("Service is unhealthy"))
            };
        }

        let status_str = match health.status {
            ServiceStatus::Healthy => "HEALTHY".green().bold(),
            ServiceStatus::Degraded => "DEGRADED".yellow().bold(),
            ServiceStatus::Unhealthy => "UNHEALTHY".red().bold(),
        };

        println!("Status:  {}", status_str);
        println!("Version: {}", health.version);

        if detailed && !health.components.is_empty() {
            println!("\nComponents:");
            for component in &health.components {
                let comp_status = match component.status {
                    ServiceStatus::Healthy => "✓".green(),
                    ServiceStatus::Degraded => "!".yellow(),
                    ServiceStatus::Unhealthy => "✗".red(),
                };
                print!("  {} {}", comp_status, component.name);
                if let Some(latency) = component.latency_ms {
                    print!(" ({}ms)", latency);
                }
                if let Some(ref msg) = component.message {
                    print!(" - {}", msg);
                }
                println!();
            }
        }

        Ok(())
    }

    /// Displays version information.
    fn version(&self) -> Result<(), CliError> {
        println!("vault {}", env!("CARGO_PKG_VERSION"));
        println!("SDK version: {}", vault_sdk::VERSION);
        println!();
        println!("Build info:");
        println!("  Target: {}", std::env::consts::ARCH);
        println!("  OS: {}", std::env::consts::OS);

        if let Ok(profile) = std::env::var("PROFILE") {
            println!("  Profile: {}", profile);
        }

        Ok(())
    }
}

/// Client configuration built from CLI args.
#[derive(Debug, Clone)]
pub struct ClientConfig {
    /// Base URL.
    pub base_url: String,
    /// Authentication method.
    pub auth: AuthMethod,
    /// Request timeout in seconds.
    pub timeout_secs: u64,
}

/// Authentication method.
#[derive(Debug, Clone)]
pub enum AuthMethod {
    /// API key authentication.
    ApiKey(String),
    /// Bearer token authentication.
    Token(String),
    /// No authentication.
    None,
}

impl ClientConfig {
    /// Builds a Vault client from this configuration.
    pub fn build_client(&self) -> Result<vault_sdk::VaultClient, CliError> {
        use std::time::Duration;

        let mut builder = vault_sdk::VaultClient::builder()
            .base_url(&self.base_url)
            .timeout(Duration::from_secs(self.timeout_secs));

        match &self.auth {
            AuthMethod::ApiKey(key) => {
                builder = builder.api_key(key);
            }
            AuthMethod::Token(token) => {
                builder = builder.bearer_token(token);
            }
            AuthMethod::None => {}
        }

        builder.build().map_err(CliError::from)
    }
}
