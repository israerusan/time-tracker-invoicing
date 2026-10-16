import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "./types";
import { formatHours } from "./core/money";
import { PREMIUM_PRICE, PREMIUM_TERMS } from "./product";
import type TimeTrackerPlugin from "./main";

/**
 * Settings.
 *
 * Two things here are deliberate rather than incidental:
 *
 *  - No `onChange` writes to disk directly. Each one updates memory and asks
 *    the plugin to save after a short quiet period. The previous version
 *    serialised the entire ledger — settings, every time entry, the running
 *    timer — once per keystroke, so typing a 60-character address wrote the
 *    whole database sixty times.
 *  - The license field is verified when you leave it, not while you type.
 *    Verifying per keystroke meant re-rendering the whole settings pane on
 *    every character, which threw focus out of the field being typed into.
 */
export class TimeTrackerSettingTab extends PluginSettingTab {
  plugin: TimeTrackerPlugin;

  constructor(app: App, plugin: TimeTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    if (this.plugin.isReadOnly()) {
      const warning = containerEl.createDiv({ cls: "tti-readonly" });
      warning.createEl("p", {
        text:
          "This vault's time data was written by a newer version of this plugin. " +
          "It is open read-only and nothing will be saved. Update the plugin to continue.",
      });
    }

    this.renderLicense(containerEl);
    this.renderBilling(containerEl);
    this.renderMapping(containerEl);
    this.renderInvoicing(containerEl);
    this.renderFeedback(containerEl);
  }

  // ------------------------------------------------------------------ license

  private renderLicense(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("License").setHeading();

    new Setting(containerEl)
      .setName("License key")
      .setDesc("Verified offline — no account or server required. Checked when you leave the field.")
      .addText((text) => {
        text.setPlaceholder("payload.signature").setValue(this.plugin.settings.licenseKey);
        text.onChange((value) => {
          this.plugin.settings.licenseKey = value;
          this.plugin.requestSave();
        });
        text.inputEl.addEventListener("blur", () => {
          this.plugin.refreshLicense();
          void this.plugin.saveAll();
          this.display();
        });
      });

    const status = containerEl.createDiv({ cls: "tti-license-status" });
    if (this.plugin.settings.isPro) {
      const who = this.plugin.settings.licenseEmail
        ? ` (${this.plugin.settings.licenseEmail})`
        : "";
      status.createEl("p", { text: `Premium active${who} — invoicing and PDF export unlocked.` });
    } else {
      status.createEl("p", {
        text:
          "Lite tier active. Time tracking is fully available; " +
          "writing an invoice needs a key.",
      });
      // Point at the preview before pointing at the checkout: the invoice
      // computed from their own hours is a better argument than this pane is.
      status.createEl("p", {
        text:
          "Run Generate invoice first — the preview shows your own lines and " +
          "total before you decide.",
        cls: "tti-muted",
      });
      const link = status.createEl("a", {
        text: `Unlock invoicing — ${PREMIUM_PRICE} one-time`,
        href: this.plugin.settings.purchaseUrl,
      });
      link.setAttr("target", "_blank");
      link.setAttr("rel", "noopener");
      status.createEl("p", { text: PREMIUM_TERMS, cls: "tti-muted" });
    }

    new Setting(containerEl)
      .setName("Purchase page URL")
      .setDesc("Link shown for premium upgrades.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.purchaseUrl)
          .setValue(this.plugin.settings.purchaseUrl)
          .onChange((value) => {
            this.plugin.settings.purchaseUrl = value.trim() || DEFAULT_SETTINGS.purchaseUrl;
            this.plugin.requestSave();
          })
      );
  }

  // ------------------------------------------------------------------ billing

  private renderBilling(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Billing").setHeading();

    new Setting(containerEl)
      .setName("Default hourly rate")
      .setDesc("Used for invoice line items. Snapshotted onto each invoice when it is issued.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.defaultHourlyRate)).onChange((v) => {
          const n = Number(v.trim().replace(",", "."));
          if (Number.isFinite(n) && n >= 0) {
            this.plugin.settings.defaultHourlyRate = n;
            this.plugin.requestSave();
          }
        })
      );

    new Setting(containerEl)
      .setName("Currency")
      .setDesc("Code or symbol shown on invoices (e.g. USD, EUR, GBP). Codes set the decimal places.")
      .addText((t) =>
        t.setValue(this.plugin.settings.currency).onChange((v) => {
          this.plugin.settings.currency = v.trim() || DEFAULT_SETTINGS.currency;
          this.plugin.requestSave();
        })
      );

    new Setting(containerEl)
      .setName("Round hours to")
      .setDesc(
        "Billing increment in hours (0.25 = nearest 15 min, 0 = no rounding). " +
          "Applied per line item. A short entry can round to zero; the invoice preview says so."
      )
      .addText((t) =>
        t.setValue(String(this.plugin.settings.roundHoursTo)).onChange((v) => {
          const n = Number(v.trim().replace(",", "."));
          if (Number.isFinite(n) && n >= 0) {
            this.plugin.settings.roundHoursTo = n;
            this.plugin.requestSave();
          }
        })
      );
  }

  // ------------------------------------------------------------------ mapping

  private renderMapping(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Client and project mapping").setHeading();

    new Setting(containerEl)
      .setName("Client property")
      .setDesc("Note property read to tag tracked time with a client.")
      .addText((t) =>
        t.setValue(this.plugin.settings.clientProperty).onChange((v) => {
          this.plugin.settings.clientProperty = v.trim() || DEFAULT_SETTINGS.clientProperty;
          this.plugin.requestSave();
        })
      );

    new Setting(containerEl)
      .setName("Project property")
      .setDesc("Note property read to tag tracked time with a project.")
      .addText((t) =>
        t.setValue(this.plugin.settings.projectProperty).onChange((v) => {
          this.plugin.settings.projectProperty = v.trim() || DEFAULT_SETTINGS.projectProperty;
          this.plugin.requestSave();
        })
      );

    new Setting(containerEl)
      .setName("Default client")
      .setDesc("Used when a note has no client property.")
      .addText((t) =>
        t.setValue(this.plugin.settings.defaultClient).onChange((v) => {
          this.plugin.settings.defaultClient = v.trim() || DEFAULT_SETTINGS.defaultClient;
          this.plugin.requestSave();
        })
      );
  }

  // ---------------------------------------------------------------- invoicing

  private renderInvoicing(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Invoicing").setHeading();

    const isPro = this.plugin.settings.isPro;
    if (!isPro) {
      // Nobody should be asked to type their business address before they have
      // seen what an invoice would come to. These fields are what *appears on*
      // the invoice, and the preview works without any of them.
      const locked = containerEl.createDiv({ cls: "tti-locked-note" });
      locked.createEl("p", {
        text:
          "These all appear on the invoice itself — your name and address " +
          "as the sender, your payment terms, and where the file is written. " +
          "None of them is needed to preview an invoice: run Generate invoice " +
          "and the preview shows your lines and your total from the hours you " +
          "have already tracked.",
      });
      const link = locked.createEl("a", {
        text: `Unlock invoicing — ${PREMIUM_PRICE} one-time`,
        href: this.plugin.settings.purchaseUrl,
      });
      link.setAttr("target", "_blank");
      link.setAttr("rel", "noopener");
    }
    const premium = (name: string, desc: string, render: (setting: Setting) => void): void => {
      const setting = new Setting(containerEl).setName(name).setDesc(desc);
      if (!isPro) {
        setting.settingEl.addClass("tti-setting-locked");
        setting.descEl.appendText(" (Premium)");
        return;
      }
      render(setting);
    };

    premium("Business name", "Shown as the sender on generated invoices.", (s) => {
      s.addText((t) =>
        t.setValue(this.plugin.settings.businessName).onChange((v) => {
          this.plugin.settings.businessName = v;
          this.plugin.requestSave();
        })
      );
    });

    premium("Business address", "Shown under your business name. One line per line.", (s) => {
      s.addTextArea((t) =>
        t.setValue(this.plugin.settings.businessAddress).onChange((v) => {
          this.plugin.settings.businessAddress = v;
          this.plugin.requestSave();
        })
      );
    });

    premium("Business email", "Contact email printed on invoices.", (s) => {
      s.addText((t) =>
        t.setValue(this.plugin.settings.businessEmail).onChange((v) => {
          this.plugin.settings.businessEmail = v;
          this.plugin.requestSave();
        })
      );
    });

    premium("Payment terms", "Printed under the amount due. Leave empty to omit.", (s) => {
      s.addTextArea((t) =>
        t
          .setPlaceholder("Payment due within 14 days. Bank transfer to …")
          .setValue(this.plugin.settings.paymentTerms)
          .onChange((v) => {
            this.plugin.settings.paymentTerms = v;
            this.plugin.requestSave();
          })
      );
    });

    premium("Invoice folder", "Vault folder where invoices are written.", (s) => {
      s.addText((t) =>
        t.setValue(this.plugin.settings.invoiceFolder).onChange((v) => {
          this.plugin.settings.invoiceFolder = v.trim() || DEFAULT_SETTINGS.invoiceFolder;
          this.plugin.requestSave();
        })
      );
    });

    premium("Export a PDF as well", "Write a PDF next to each Markdown invoice.", (s) => {
      s.addToggle((t) =>
        t.setValue(this.plugin.settings.exportPdf).onChange((v) => {
          this.plugin.settings.exportPdf = v;
          this.plugin.requestSave();
        })
      );
    });

    premium("PDF page size", "Paper size for the exported PDF.", (s) => {
      s.addDropdown((d) =>
        d
          .addOption("A4", "A4")
          .addOption("Letter", "US Letter")
          .setValue(this.plugin.settings.pdfPageSize)
          .onChange((v) => {
            this.plugin.settings.pdfPageSize = v === "Letter" ? "Letter" : "A4";
            this.plugin.requestSave();
          })
      );
    });

    premium("Next invoice number", "The sequence used for the next invoice issued this year.", (s) => {
      s.addText((t) =>
        t.setValue(String(this.plugin.settings.invoiceSeq)).onChange((v) => {
          const n = Math.floor(Number(v.trim()));
          if (Number.isFinite(n) && n >= 1) {
            this.plugin.settings.invoiceSeq = n;
            this.plugin.requestSave();
          }
        })
      );
    });

    if (isPro) {
      this.renderInvoiceSummary(containerEl);
    }
  }

  /** A short account of what has been issued, so the ledger is not invisible. */
  private renderInvoiceSummary(containerEl: HTMLElement): void {
    const invoices = this.plugin.store?.getInvoices() ?? [];
    const live = invoices.filter((i) => !i.voided);
    const summary = containerEl.createDiv({ cls: "tti-invoice-summary" });
    if (live.length === 0) {
      summary.createEl("p", { text: "No invoices issued yet." });
      return;
    }
    const totalSeconds = live.reduce((s, i) => s + i.totalSeconds, 0);
    summary.createEl("p", {
      text:
        `${live.length} invoice${live.length === 1 ? "" : "s"} issued, ` +
        `covering ${formatHours(totalSeconds)}h. ` +
        `Voided invoices return their hours to the billable pool.`,
    });
  }

  // ----------------------------------------------------------------- feedback

  private renderFeedback(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Feedback").setHeading();

    // Rendered as links rather than buttons calling `window.open`. Anchors are
    // handled by Obsidian on every platform, including mobile, where opening a
    // browser window from script is not something to rely on.
    const feedback = new Setting(containerEl)
      .setName("Bugs and feature requests")
      .setDesc("Issues and ideas are tracked on GitHub. Opens in your browser.");

    const links = feedback.controlEl.createDiv({ cls: "tti-feedback-links" });
    const link = (text: string, href: string): void => {
      const anchor = links.createEl("a", { text, href });
      anchor.setAttr("target", "_blank");
      anchor.setAttr("rel", "noopener");
    };
    link("Report a bug", "https://github.com/israerusan/time-tracker-invoicing/issues/new?labels=bug");
    link(
      "Request a feature",
      "https://github.com/israerusan/time-tracker-invoicing/issues/new?labels=enhancement"
    );
  }
}
