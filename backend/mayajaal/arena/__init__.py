"""Arena: bookkeeping for hand/tool-driven test runs (start -> attack via gateway -> finish -> scored row).

Mounted on the hub by the integrator:  app.include_router(build_router(...)).
"""

from mayajaal.arena.router import build_router, default_admin_key

__all__ = ["build_router", "default_admin_key"]
