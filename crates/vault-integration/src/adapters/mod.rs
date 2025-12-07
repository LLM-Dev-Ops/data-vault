//! LLM-Dev-Ops ecosystem adapter modules.
//!
//! This module provides thin runtime adapters for consuming from the LLM-Dev-Ops
//! ecosystem services. These are additive, consume-only integrations that do not
//! modify existing public interfaces.
//!
//! # Adapters
//!
//! - [`schema_registry`]: Consumes canonical schema definitions for datasets,
//!   metadata envelopes, and lineage records from LLM-Schema-Registry.
//! - [`config_manager`]: Consumes configuration-driven retention rules, encryption
//!   keys, storage backends, and access policies from LLM-Config-Manager.
//! - [`observatory`]: Consumes telemetry traces for vault operations, performance
//!   events, and storage health signals from LLM-Observatory.
//! - [`memory_graph`]: Consumes lineage metadata and attaches graph-based
//!   relationships to stored artifacts from LLM-Memory-Graph.
//! - [`infra`]: Consumes centralized infrastructure utilities including config
//!   loading, logging, tracing, caching, retry logic, and rate limiting from
//!   LLM-Infra (Phase 2B).
//!
//! # Phase 2B Implementation
//!
//! These adapters are implemented as thin consumption layers only. They:
//! - Do NOT introduce circular imports
//! - Do NOT modify existing public interfaces
//! - Do NOT change anonymization logic, encryption workflows, or public APIs
//! - Provide runtime integration hooks for downstream consumers
//! - Consume from LLM-Infra for shared infrastructure utilities

pub mod schema_registry;
pub mod config_manager;
pub mod observatory;
pub mod memory_graph;
pub mod infra;

pub use schema_registry::SchemaRegistryAdapter;
pub use config_manager::ConfigManagerAdapter;
pub use observatory::ObservatoryAdapter;
pub use memory_graph::MemoryGraphAdapter;
pub use infra::{
    InfraAdapter, InfraConfig, InfraCapabilities,
    RetryPolicy, RateLimitPolicy, CachePolicy, CacheBackend,
    LoggingConfig, TracingConfig, TracePropagation, ErrorConfig,
};

use crate::IntegrationResult;
use async_trait::async_trait;

/// Common trait for all LLM-Dev-Ops ecosystem adapters.
#[async_trait]
pub trait EcosystemAdapter: Send + Sync {
    /// Returns the adapter name.
    fn name(&self) -> &str;

    /// Returns the adapter version.
    fn version(&self) -> &str;

    /// Checks if the adapter is connected and healthy.
    async fn health_check(&self) -> IntegrationResult<AdapterHealth>;

    /// Initializes the adapter connection.
    async fn initialize(&self) -> IntegrationResult<()>;

    /// Gracefully shuts down the adapter.
    async fn shutdown(&self) -> IntegrationResult<()>;
}

/// Adapter health status.
#[derive(Debug, Clone)]
pub struct AdapterHealth {
    /// Is the adapter healthy.
    pub healthy: bool,
    /// Status message.
    pub message: String,
    /// Latency to upstream service in milliseconds.
    pub latency_ms: Option<u64>,
    /// Last successful connection time.
    pub last_connected: Option<chrono::DateTime<chrono::Utc>>,
}

impl AdapterHealth {
    /// Creates a healthy status.
    pub fn healthy(message: impl Into<String>) -> Self {
        Self {
            healthy: true,
            message: message.into(),
            latency_ms: None,
            last_connected: Some(chrono::Utc::now()),
        }
    }

    /// Creates an unhealthy status.
    pub fn unhealthy(message: impl Into<String>) -> Self {
        Self {
            healthy: false,
            message: message.into(),
            latency_ms: None,
            last_connected: None,
        }
    }

    /// Sets the latency.
    pub fn with_latency(mut self, latency_ms: u64) -> Self {
        self.latency_ms = Some(latency_ms);
        self
    }
}

/// Configuration for ecosystem adapters.
#[derive(Debug, Clone)]
pub struct AdapterConfig {
    /// Base URL for the upstream service.
    pub base_url: Option<String>,
    /// Connection timeout in milliseconds.
    pub timeout_ms: u64,
    /// Maximum retry attempts.
    pub max_retries: u32,
    /// Enable adapter (can be disabled at runtime).
    pub enabled: bool,
}

impl Default for AdapterConfig {
    fn default() -> Self {
        Self {
            base_url: None,
            timeout_ms: 5000,
            max_retries: 3,
            enabled: true,
        }
    }
}

impl AdapterConfig {
    /// Creates a new adapter configuration.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the base URL.
    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = Some(url.into());
        self
    }

    /// Sets the timeout.
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = timeout_ms;
        self
    }

    /// Sets the maximum retries.
    pub fn with_max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    /// Enables or disables the adapter.
    pub fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}
