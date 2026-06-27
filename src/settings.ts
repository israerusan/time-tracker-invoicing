import { App, PluginSettingTab, Setting } from "obsidian";
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

    containerEl.createEl("h2", { text: "Time Tracker & Invoicing" });

    // ---- License ---------------------------------------------------------
    containerEl.createEl("h3", { text: "License" });
    const isPremium = this.plugin.licenseManager.isPremium();
    containerEl.createDiv({
      cls: "tti-settings-status",
      text: isPremium
        ? "✅ Premium active — invoicing & PDF export unlocked."
        : "🔓 Lite tier (free). Time tracking is fully available; invoicing is premium.",
    });
    const status = this.plugin.licenseManager.getStatus();
    if (status.message) {
      containerEl.createEl("p", { cls: "tti-muted", text: status.message });
    }

    new Setting(containerEl)
      .setName("License key")
      .setDesc("Your license key. Leave blank for the free lite tier.")
      .addText((t) =>
        t
          .setPlaceholder("PREMIUM-XXXX-XXXX-XXXX")
          .setValue(this.plugin.settings.licenseKey)
          .onChange(async (v) => {
            this.plugin.settings.licenseKey = v.trim();
            await this.plugin.saveAll();
          })
      );

    new Setting(containerEl)
      .setName("Validation endpoint")
      .setDesc("License validation URL. Advanced — change only if self-hosting.")
      .addText((t) =>
        t.setValue(this.plugin.settings.licenseEndpoint).onChange(async (v) => {
          this.plugin.settings.licenseEndpoint = v.trim();
          await this.plugin.saveAll();
        })
      );

    new Setting(containerEl)
      .setName("Verify license")
      .addButton((b) =>
        b
          .setButtonText("Verify now")
          .setCta()
          .onClick(async () => {
            b.setButtonText("Checking…");
            b.setDisabled(true);
            await this.plugin.refreshLicense();
            this.display();
          })
      );

    // ---- Billing defaults ------------------------------------------------
    containerEl.createEl("h3", { text: "Billing" });

    new Setting(containerEl)
      .setName("Default hourly rate")
      .setDesc("Used for invoice line items.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.defaultHourlyRate))
          .onChange(async (v) => {
            const n = Number(v);
            if (!isNaN(n) && n >= 0) {
              this.plugin.settings.defaultHourlyRate = n;
              await this.plugin.saveAll();
            }
          })
      );

    new Setting(containerEl)
      .setName("Currency")
      .setDesc("Currency code or symbol shown on invoices (e.g. USD, EUR, £).")
      .addText((t) =>
        t.setValue(this.plugin.settings.currency).onChange(async (v) => {
          this.plugin.settings.currency = v.trim() || "USD";
          await this.plugin.saveAll();
        })
      );

    new Setting(containerEl)
      .setName("Round hours to")
      .setDesc("Billing increment in hours (e.g. 0.25 = nearest 15 min, 0 = no rounding).")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.roundHoursTo))
          .onChange(async (v) => {
            const n = Number(v);
            if (!isNaN(n) && n >= 0) {
              this.plugin.settings.roundHoursTo = n;
              await this.plugin.saveAll();
            }
          })
      );

    // ---- Client/project mapping -----------------------------------------
    containerEl.createEl("h3", { text: "Client & project mapping" });

    new Setting(containerEl)
      .setName("Client frontmatter property")
      .setDesc("Note property read to tag tracked time with a client.")
      .addText((t) =>
        t.setValue(this.plugin.settings.clientProperty).onChange(async (v) => {
          this.plugin.settings.clientProperty = v.trim() || "client";
          await this.plugin.saveAll();
        })
      );

    new Setting(containerEl)
      .setName("Project frontmatter property")
      .setDesc("Note property read to tag tracked time with a project.")
      .addText((t) =>
        t.setValue(this.plugin.settings.projectProperty).onChange(async (v) => {
          this.plugin.settings.projectProperty = v.trim() || "project";
          await this.plugin.saveAll();
        })
      );

    new Setting(containerEl)
      .setName("Default client")
      .setDesc("Used when a note has no client property.")
      .addText((t) =>
        t.setValue(this.plugin.settings.defaultClient).onChange(async (v) => {
          this.plugin.settings.defaultClient = v.trim() || "Unassigned";
          await this.plugin.saveAll();
        })
      );

    // ---- Business identity ----------------------------------------------
    containerEl.createEl("h3", { text: "Business details (on invoices)" });

    new Setting(containerEl).setName("Business name").addText((t) =>
      t.setValue(this.plugin.settings.businessName).onChange(async (v) => {
        this.plugin.settings.businessName = v;
        await this.plugin.saveAll();
      })
    );

    new Setting(containerEl).setName("Business address").addTextArea((t) =>
      t.setValue(this.plugin.settings.businessAddress).onChange(async (v) => {
        this.plugin.settings.businessAddress = v;
        await this.plugin.saveAll();
      })
    );

    new Setting(containerEl).setName("Business email").addText((t) =>
      t.setValue(this.plugin.settings.businessEmail).onChange(async (v) => {
        this.plugin.settings.businessEmail = v;
        await this.plugin.saveAll();
      })
    );

    new Setting(containerEl)
      .setName("Invoice folder")
      .setDesc("Vault folder where generated invoices are saved.")
      .addText((t) =>
        t.setValue(this.plugin.settings.invoiceFolder).onChange(async (v) => {
          this.plugin.settings.invoiceFolder = v.trim() || "Invoices";
          await this.plugin.saveAll();
        })
      );
  }
}
