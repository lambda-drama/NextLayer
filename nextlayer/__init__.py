__version__ = "0.0.1"


def _apply_patches():
	"""Apply patch so scheduler (repost_entries) also recreates Sales Shipment Cost GL."""
	from nextlayer.next_layer.controllers import sales_shipment  # noqa: F401 - applies RIV patch


_apply_patches()
