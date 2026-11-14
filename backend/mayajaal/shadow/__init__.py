"""Shadow tier: a session-seeded fake hospital network. Never touches the real tier."""

from mayajaal.shadow.registry import get_shadow_world, get_static_world, shadow_key
from mayajaal.shadow.world import ShadowWorld

__all__ = ["ShadowWorld", "get_shadow_world", "get_static_world", "shadow_key"]
