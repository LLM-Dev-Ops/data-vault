//! Event system and webhooks for LLM Data Vault.
//!
//! This crate provides:
//! - Event-driven architecture
//! - Webhook delivery with retry logic
//! - Event subscription management
//! - Integration with external systems
//! - LLM-Dev-Ops ecosystem adapters (Phase 2B)

pub mod error;
pub mod event;
pub mod bus;
pub mod webhook;
pub mod subscription;
pub mod delivery;
pub mod handler;
pub mod adapters;

pub use error::{IntegrationError, IntegrationResult};
pub use event::{Event, EventType, EventPayload, EventMetadata};
pub use bus::{EventBus, EventBusConfig};
pub use webhook::{Webhook, WebhookConfig, WebhookSecret};
pub use subscription::{Subscription, SubscriptionManager, EventFilter};
pub use delivery::{DeliveryManager, DeliveryStatus, DeliveryAttempt};
pub use handler::{EventHandler, HandlerRegistry};

// LLM-Dev-Ops ecosystem adapter re-exports (Phase 2A)
pub use adapters::{
    AdapterConfig, AdapterHealth, EcosystemAdapter,
    SchemaRegistryAdapter, ConfigManagerAdapter,
    ObservatoryAdapter, MemoryGraphAdapter,
};

// LLM-Infra adapter re-exports (Phase 2B)
pub use adapters::{
    InfraAdapter, InfraConfig, InfraCapabilities,
    RetryPolicy, RateLimitPolicy, CachePolicy, CacheBackend,
    LoggingConfig, TracingConfig, TracePropagation, ErrorConfig,
};
