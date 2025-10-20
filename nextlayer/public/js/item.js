// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Item", {
	refresh(frm) {
		// Add Print Barcode button
		if (frm.doc.name && !frm.is_new()) {
			frm.add_custom_button(__("Print Barcode"), function() {
				show_barcode_selection_modal(frm);
			}, __("Actions"));
		}
	}
});

function show_barcode_selection_modal(frm) {
	// Get all barcodes for this item
	frappe.call({
		method: "nextlayer.next_layer.controllers.generate_barcode.get_item_barcodes",
		args: {
			item_code: frm.doc.name
		},
		callback: function(r) {
			if (r.message && r.message.length > 0) {
				if (r.message.length === 1) {
					// Only one barcode, print directly
					print_barcode(frm.doc.name, r.message[0]);
				} else {
					// Multiple barcodes, show selection modal
					show_barcode_modal(frm, r.message);
				}
			} else {
				frappe.msgprint(__("No barcodes found for this item. Please generate barcodes first."));
			}
		}
	});
}

function show_barcode_modal(frm, barcodes) {
	let modal = new frappe.ui.Dialog({
		title: __("Select Barcode to Print"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "barcode_list",
				options: get_barcode_list_html(frm, barcodes)
			}
		],
		primary_action_label: __("Close"),
		primary_action: function() {
			modal.hide();
		}
	});

	modal.show();

	// Add event delegation for print buttons after modal is shown
	setTimeout(function() {
		// Handle barcode item selection
		$(modal.body).on('click', '.barcode-item', function(e) {
			if (!$(e.target).hasClass('print-btn')) {
				$('.barcode-item').removeClass('selected');
				$(this).addClass('selected');
			}
		});

		// Handle print button clicks
		$(modal.body).on('click', '.print-btn', function(e) {
			e.stopPropagation();
			let $item = $(this).closest('.barcode-item');
			let item_code = $item.data('item');
			let barcode = $item.data('barcode');
			let custom_image = $item.data('image');

			console.log('Print button clicked:');
			console.log('- Item code from data:', item_code);
			console.log('- Barcode from data:', barcode);
			console.log('- Image from data:', custom_image);
			console.log('- Current form item:', cur_frm ? cur_frm.doc.name : 'No current form');
			console.log('- Current form item name:', cur_frm ? cur_frm.doc.item_name : 'No current form');

			// Close modal first
			modal.hide();

			// Then print
			print_barcode(item_code, {
				barcode: barcode,
				custom_image: custom_image
			});
		});
	}, 100);
}

function get_barcode_list_html(frm, barcodes) {
	let html = `
		<div class="barcode-selection-list">
			<style>
				.barcode-item {
					border: 1px solid #d1d8dd;
					border-radius: 4px;
					padding: 15px;
					margin: 10px 0;
					cursor: pointer;
					transition: background-color 0.2s;
				}
				.barcode-item:hover {
					background-color: #f8f9fa;
				}
				.barcode-item.selected {
					background-color: #e3f2fd;
					border-color: #2196f3;
				}
				.barcode-info {
					display: flex;
					justify-content: space-between;
					align-items: center;
				}
				.barcode-text {
					font-weight: bold;
					font-size: 16px;
					color: #333;
				}
				.barcode-type {
					color: #666;
					font-size: 12px;
				}
				.barcode-image {
					max-width: 150px;
					max-height: 50px;
					border: 1px solid #ddd;
				}
				.print-btn {
					background-color: #1568C6;
					color: white;
					border: none;
					padding: 8px 16px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 12px;
				}
				.print-btn:hover {
					background-color: #0d47a1;
				}
			</style>
	`;

	barcodes.forEach(function(barcode, index) {
		let image_html = '';
		if (barcode.custom_image) {
			image_html = `<img src="${barcode.custom_image}" class="barcode-image" alt="Barcode">`;
		} else {
			image_html = '<div style="color: #999; font-size: 12px;">No image available</div>';
		}

		html += `
			<div class="barcode-item" data-barcode="${barcode.barcode}" data-image="${barcode.custom_image || ''}" data-item="${frm.doc.name}">
				<div class="barcode-info">
					<div>
						<div class="barcode-text">${barcode.barcode}</div>
						<div class="barcode-type">${barcode.barcode_type || 'EAN'}</div>
					</div>
					<div>
						${image_html}
					</div>
					<div>
						<button class="print-btn" data-action="print">
							Print
						</button>
					</div>
				</div>
			</div>
		`;
	});

	html += `</div>`;

	return html;
}

function printSelectedBarcode(item_code, barcode, custom_image) {
	console.log('Printing barcode:', barcode, 'for item:', item_code);
	print_barcode(item_code, {
		barcode: barcode,
		custom_image: custom_image
	});
}

function print_barcode(item_code, barcode_data) {
	// Generate print content and trigger browser print
	generate_print_content(item_code, barcode_data);
}

function generate_print_content(item_code, barcode_data) {
	console.log('Generating print content for:', item_code, barcode_data);
	console.log('Current form item:', cur_frm ? cur_frm.doc.name : 'No current form');
	console.log('Current form item name:', cur_frm ? cur_frm.doc.item_name : 'No current form');

	// Use current form data if available, otherwise fetch from API
	let item_data;
	if (cur_frm && cur_frm.doc && cur_frm.doc.name === item_code) {
		console.log('Using current form data');
		item_data = {
			item_name: cur_frm.doc.item_name,
			stock_uom: cur_frm.doc.stock_uom
		};
		let print_html = create_print_html(item_data, barcode_data);
		console.log('Print HTML created, opening dialog...');
		open_print_dialog(print_html);
	} else {
		console.log('Fetching item data from API');
		// Get item details
		frappe.call({
			method: "frappe.client.get_value",
			args: {
				doctype: "Item",
				name: item_code,
				fieldname: ["item_name", "stock_uom"]
			},
			callback: function(r) {
				console.log('Item data received:', r.message);
				if (r.message) {
					let item_data = r.message;
					let print_html = create_print_html(item_data, barcode_data);
					console.log('Print HTML created, opening dialog...');
					open_print_dialog(print_html);
				} else {
					console.error('No item data received');
				}
			},
			error: function(err) {
				console.error('Error getting item data:', err);
			}
		});
	}
}

function create_print_html(item_data, barcode_data) {
	let image_html = '';
	if (barcode_data.custom_image) {
		image_html = `<img src="${barcode_data.custom_image}" style="width: 100%; margin-top: 5px;">`;
	} else {
		image_html = `<p style="text-align: center; margin-top: 10px;">${barcode_data.barcode}</p>`;
	}

	return `
		<!DOCTYPE html>
		<html>
		<head>
			<title>Barcode Print</title>
			<style>
				@media print {
					@page {
						size: 8cm 10cm;
						margin: 0;
					}
					body {
						margin: 0;
						padding: 0;
					}
				}

				.print-format {
					width: 8cm;
					height: 10cm;
					padding: 5px;
					font-family: Arial, sans-serif;
					font-size: 14px;
				}

				.container {
					width: 100%;
					text-align: center;
					padding: 5px;
				}

				.title {
					font-size: 14px;
					font-weight: bold;
					margin-bottom: 5px;
				}

				.uom {
					font-size: 12px;
					margin-bottom: 10px;
				}

				.barcode {
					margin-top: 5px;
				}
			</style>
		</head>
		<body>
			<div class="print-format">
				<div class="container">
					<div class="title">${item_data.item_name}</div>
					<div class="uom">UOM: ${item_data.stock_uom}</div>
					<div class="barcode">
						${image_html}
					</div>
				</div>
			</div>
		</body>
		</html>
	`;
}

function open_print_dialog(html_content) {
	console.log('Opening print dialog with content length:', html_content.length);

	// Create a new window with the print content
	let printWindow = window.open('', '_blank', 'width=600,height=400');

	if (!printWindow) {
		console.error('Failed to open print window - popup blocked?');
		frappe.msgprint(__("Popup blocked! Please allow popups for this site and try again."));
		return;
	}

	// Write the HTML content
	printWindow.document.write(html_content);
	printWindow.document.close();

	console.log('Print window opened, waiting for load...');

	// Wait for images to load, then trigger print
	printWindow.onload = function() {
		console.log('Print window loaded, triggering print...');
		setTimeout(function() {
			printWindow.print();
			printWindow.close();
		}, 500);
	};

	// Fallback if onload doesn't fire
	setTimeout(function() {
		if (printWindow && !printWindow.closed) {
			console.log('Fallback: triggering print after timeout...');
			printWindow.print();
			printWindow.close();
		}
	}, 2000);
}
