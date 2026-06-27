import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "./types";
import type TimeTrackerPlugin from "./main";

export class TimeTrackerSettingTab extends PluginSettingTab {
	plugin: TimeTrackerPlugin;

	constructor(app: App, plugin: TimeTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ---- License ---------------------------------------------------------
		new Setting(containerEl).setName("License").setHeading();

		new Setting(containerEl)
			.setName("License key")
			.setDesc("Enter your premium license key. Verified offline — no account or server required.")
			.addText((text) =>
				text
					.setPlaceholder("payload.signature")
					.setValue(this.plugin.settings.licenseKey)
					.onChange((value) => {
						this.plugin.settings.licenseKey = value;
						void this.plugin.refreshLicense().then(() => this.display());
					})
			);

		const status = containerEl.createDiv({ cls: "tti-license-status" });
		if (this.plugin.settings.isPro) {
			status.createEl("p", {
				text: `✅ Premium active${this.plugin.settings.licenseEmail ? ` (${this.plugin.settings.licenseEmail})` : ""} — invoicing & PDF export unlocked.`,
			});
		} else {
			status.createEl("p", {
				text: "🔓 Lite tier active. Time tracking is fully available; upgrade to unlock invoicing & PDF export.",
			});
			const link = status.createEl("a", {
				text: "Get Time Tracker & Invoicing premium",
				href: this.plugin.settings.purchaseUrl,
			});
			link.setAttr("target", "_blank");
		}

		new Setting(containerEl)
			.setName("Purchase page URL")
			.setDesc("Link shown for premium upgrades.")
			.addText((text) =>
				text
					.setPlaceholder("https://your-store.com/product")
					.setValue(this.plugin.settings.purchaseUrl)
					.onChange((value) => {
						this.plugin.settings.purchaseUrl = value.trim() || DEFAULT_SETTINGS.purchaseUrl;
						void this.plugin.saveAll();
					})
			);

		// ---- Billing defaults ------------------------------------------------
		new Setting(containerEl).setName("Billing").setHeading();

		new Setting(containerEl)
			.setName("Default hourly rate")
			.setDesc("Used for invoice line items.")
			.addText((t) =>
				t.setValue(String(this.plugin.settings.defaultHourlyRate)).onChange((v) => {
					const n = Number(v);
					if (!isNaN(n) && n >= 0) {
						this.plugin.settings.defaultHourlyRate = n;
						void this.plugin.saveAll();
					}
				})
			);

		new Setting(containerEl)
			.setName("Currency")
			.setDesc("Currency code or symbol shown on invoices (e.g. USD, EUR, £).")
			.addText((t) =>
				t.setValue(this.plugin.settings.currency).onChange((v) => {
					this.plugin.settings.currency = v.trim() || "USD";
					void this.plugin.saveAll();
				})
			);

		new Setting(containerEl)
			.setName("Round hours to")
			.setDesc("Billing increment in hours (e.g. 0.25 = nearest 15 min, 0 = no rounding).")
			.addText((t) =>
				t.setValue(String(this.plugin.settings.roundHoursTo)).onChange((v) => {
					const n = Number(v);
					if (!isNaN(n) && n >= 0) {
						this.plugin.settings.roundHoursTo = n;
						void this.plugin.saveAll();
					}
				})
			);

		// ---- Client/project mapping -----------------------------------------
		new Setting(containerEl).setName("Client & project mapping").setHeading();

		new Setting(containerEl)
			.setName("Client frontmatter property")
			.setDesc("Note property read to tag tracked time with a client.")
			.addText((t) =>
				t.setValue(this.plugin.settings.clientProperty).onChange((v) => {
					this.plugin.settings.clientProperty = v.trim() || "client";
					void this.plugin.saveAll();
				})
			);

		new Setting(containerEl)
			.setName("Project frontmatter property")
			.setDesc("Note property read to tag tracked time with a project.")
			.addText((t) =>
				t.setValue(this.plugin.settings.projectProperty).onChange((v) => {
					this.plugin.settings.projectProperty = v.trim() || "project";
					void this.plugin.saveAll();
				})
			);

		new Setting(containerEl)
			.setName("Default client")
			.setDesc("Used when a note has no client property.")
			.addText((t) =>
				t.setValue(this.plugin.settings.defaultClient).onChange((v) => {
					this.plugin.settings.defaultClient = v.trim() || "Unassigned";
					void this.plugin.saveAll();
				})
			);

		// ---- Business identity (premium: appears on invoices) ----------------
		new Setting(containerEl).setName("Invoicing (Premium)").setHeading();

		// Gate invoice-only settings inline — same pattern as Vault Spotlight's
		// proSearch() helper: locked rows show a "(Premium)" hint until licensed.
		const premium = (name: string, desc: string, render: (setting: Setting) => void) => {
			const setting = new Setting(containerEl).setName(name).setDesc(desc);
			if (!this.plugin.settings.isPro) {
				setting.settingEl.addClass("tti-setting-locked");
				setting.descEl.appendText(" (Premium)");
				return;
			}
			render(setting);
		};

		premium("Business name", "Shown as the sender on generated invoices.", (s) =>
			s.addText((t) =>
				t.setValue(this.plugin.settings.businessName).onChange((v) => {
					this.plugin.settings.businessName = v;
					void this.plugin.saveAll();
				})
			)
		);

		premium("Business address", "Shown under your business name.", (s) =>
			s.addTextArea((t) =>
				t.setValue(this.plugin.settings.businessAddress).onChange((v) => {
					this.plugin.settings.businessAddress = v;
					void this.plugin.saveAll();
				})
			)
		);

		premium("Business email", "Contact email printed on invoices.", (s) =>
			s.addText((t) =>
				t.setValue(this.plugin.settings.businessEmail).onChange((v) => {
					this.plugin.settings.businessEmail = v;
					void this.plugin.saveAll();
				})
			)
		);

		premium("Invoice folder", "Vault folder where generated invoices are saved.", (s) =>
			s.addText((t) =>
				t.setValue(this.plugin.settings.invoiceFolder).onChange((v) => {
					this.plugin.settings.invoiceFolder = v.trim() || "Invoices";
					void this.plugin.saveAll();
				})
			)
		);
	}
}
