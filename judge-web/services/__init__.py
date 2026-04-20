"""HTTP client for the Case API Gateway."""

from .gateway_client import (
    GatewayClient,
    GatewayError,
    GatewayTransportError,
    cookies_as_dict,
    get_client,
    get_gateway_client,
)

__all__ = [
    "GatewayClient",
    "GatewayError",
    "GatewayTransportError",
    "cookies_as_dict",
    "get_client",
    "get_gateway_client",
]
