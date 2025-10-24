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
					print_barcode(frm.doc.name, {
						barcode: r.message[0].barcode,
						custom_image: r.message[0].custom_image,
						barcode_id: r.message[0].name
					});
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
			let barcode_id = $item.data('barcode-id');


			// Close modal first
			modal.hide();

			// Then print
			print_barcode(item_code, {
				barcode: barcode,
				custom_image: custom_image,
				barcode_id: barcode_id
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
					font-size: 10px;
					color: #333;
				}
				.barcode-type {
					color: #666;
					font-size: 10px;
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
		if (barcode.custom_image && barcode.custom_image !== '') {
			image_html = `<img src="${barcode.custom_image}" class="barcode-image" alt="Barcode ${barcode.barcode}">`;
		} else {
			image_html = '<div style="color: #999; font-size: 12px; padding: 10px; border: 1px dashed #ccc;">Image will be generated when printing</div>';
		}

		html += `
			<div class="barcode-item" data-barcode="${barcode.barcode}" data-image="${barcode.custom_image || ''}" data-item="${frm.doc.name}" data-barcode-id="${barcode.name || ''}">
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
	print_barcode(item_code, {
		barcode: barcode,
		custom_image: custom_image
	});
}

function print_barcode(item_code, barcode_data) {
	// Check if custom_image exists and is valid
	if (!barcode_data.custom_image || barcode_data.custom_image === '') {
		console.log('No custom_image found, generating barcode image first...');

		// Show loading message
		frappe.show_alert({
			message: __('Generating barcode image...'),
			indicator: 'blue'
		});

		// Generate barcode image on-demand for this specific barcode
		frappe.call({
			method: "nextlayer.next_layer.controllers.generate_barcode.generate_and_save_barcode_image",
			args: {
				barcode_id: barcode_data.barcode_id || barcode_data.name
			},
			callback: function(r) {
				if (r.message && r.message.status === 'success') {
					console.log('Barcode image generated successfully, proceeding to print...');

					// Update barcode_data with the new image
					barcode_data.custom_image = r.message.image_url;

					// Show success message
					frappe.show_alert({
						message: __('Barcode image ready! Proceeding to print...'),
						indicator: 'green'
					});

					// Now proceed to print with the generated image
					generate_print_content(item_code, barcode_data);
				} else {
					console.error('Error generating barcode image:', r.message);
					frappe.msgprint(__('Failed to generate barcode image: ') + (r.message?.message || 'Unknown error'));
				}
			},
			error: function(err) {
				console.error('Error calling image generation API:', err);
				frappe.msgprint(__('Failed to generate barcode image. Please try again.'));
			}
		});
	} else {
		console.log('Custom image exists, proceeding to print directly...');
		// Image exists, proceed to print directly
		generate_print_content(item_code, barcode_data);
	}
}

function generate_print_content(item_code, barcode_data) {

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
	if (barcode_data.custom_image && barcode_data.custom_image !== '') {
		image_html = `<img src="${barcode_data.custom_image}" style="width: 100%; margin-top: 5px;" alt="Barcode ${barcode_data.barcode}">`;
	} else {
		// Fallback: show barcode number as text if image is not available
		image_html = `
			<div style="text-align: center; margin-top: 10px; font-family: monospace; font-size: 16px; font-weight: bold;">
				${barcode_data.barcode}
			</div>
			<div style="text-align: center; margin-top: 5px; font-size: 12px; color: #666;">
				(Barcode Image Not Available)
			</div>
		`;
	}

	return `
		<!DOCTYPE html>
		<html>
		<head>
			<title>Barcode Print</title>
			<style>
				.print-format {
					width: 5cm;
					height: 10cm;
					padding: 4px;
					border: 0.5px dashed #888;
					box-sizing: border-box;
				}

				@page {
					size: 5cm 10cm;
					margin: 0;
				}

				body {
					font-family: Arial, sans-serif;
					font-size: 10px;
					margin: 0;
					padding: 0;
				}

				.container {
					width: 100%;
					text-align: center;
					padding: 3px;
					box-sizing: border-box;
				}

				.title {
					font-size: 10px;
					margin: 4px 0;
					text-transform: uppercase;
					word-wrap: break-word;
				}

				.info {
					text-align: center;
					margin: 2px 0;
					line-height: 1.2;
					font-size: 9px;
				}

				.barcode img {
					width: 100%;
					max-height: 5cm;
					object-fit: contain;
					margin: 3px 0;
				}

				.footer {
					text-align: center;
					font-weight: bold;
					font-size: 9px;
					text-transform: uppercase;
					margin-top: 4px;
				}
			</style>
		</head>
		<body>
			<div class="print-format">
				<div class="container">
					<div class="info">
						<div>MRK - R.M.D</div>
						<div>M/C-3</div>
						<div>ART-RYL-AIR</div>
						<div class="title">${item_data.item_name}</div>
					</div>

					<div class="barcode">
						${image_html}
					</div>

					<div class="footer">Made in India</div>
				</div>
			</div>
		</body>
		</html>
	`;
}

function open_print_dialog(html_content) {
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

	// Wait for images to load, then trigger print
	printWindow.onload = function() {
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
