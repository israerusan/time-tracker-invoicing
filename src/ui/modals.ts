import { App, FuzzySuggestModal, Modal, Setting, SuggestModal } from "obsidian";
import { InvoiceDraft } from "../core/invoiceModel";
import { formatHours, formatMoney } from "../core/money";
import {
  BillingPeriod,
  isoDate,
  monthPeriod,
  nextLocalMidnight,
  parseLocalDate,
  periodRangeLabel,
  previousMonthPeriod,
} from "../core/period";
import { ClientTotals } from "../timeStore";

/** Pick which client to invoice, showing what is actually left to bill. */
export class ClientPickModal extends FuzzySuggestModal<ClientTotals> {
  private totals: ClientTotals[];
  private onPick: (client: string) => void;

  constructor(app: App, totals: ClientTotals[], onPick: (client: string) => void) {
    super(app);
    this.totals = totals;
    this.onPick = onPick;
    this.setPlaceholder("Select a client to invoice…");
  }

  getItems(): ClientTotals[] {
    return this.totals;
  }

  getItemText(item: ClientTotals): string {
    return `${item.client} — ${formatHours(item.unbilledSeconds)}h unbilled`;
  }

  onChooseItem(item: ClientTotals): void {
    this.onPick(item.client);
  }
}

interface PeriodChoice {
  label: string;
  description: string;
  period: BillingPeriod | null;
  custom?: boolean;
}

/** Pick the billing period. Periods are half-open and split entries cleanly. */
export class PeriodPickModal extends SuggestModal<PeriodChoice> {
  private onPick: (period: BillingPeriod | null) => void;
  private now: number;

  constructor(app: App, now: number, onPick: (period: BillingPeriod | null) => void) {
    super(app);
    this.now = now;
    this.onPick = onPick;
    this.setPlaceholder("Which period should this invoice cover?");
  }

  getSuggestions(): PeriodChoice[] {
    const previous = previousMonthPeriod(this.now);
    const current = monthPeriod(this.now);
    return [
      {
        label: `Last month — ${previous.label}`,
        description: periodRangeLabel(previous),
        period: previous,
      },
      {
        label: `This month — ${current.label}`,
        description: periodRangeLabel(current),
        period: current,
      },
      {
        label: "All unbilled time",
        description: "Every hour not already allocated to an invoice.",
        period: null,
      },
      {
        label: "Custom range…",
        description: "Enter a start and end date.",
        period: null,
        custom: true,
      },
    ];
  }

  renderSuggestion(choice: PeriodChoice, el: HTMLElement): void {
    el.createDiv({ text: choice.label, cls: "tti-suggest-title" });
    el.createDiv({ text: choice.description, cls: "tti-suggest-desc" });
  }

  onChooseSuggestion(choice: PeriodChoice): void {
    if (choice.custom) {
      new CustomPeriodModal(this.app, this.now, this.onPick).open();
      return;
    }
    this.onPick(choice.period);
  }
}

/** Two dates, validated. The end date is inclusive in the UI, exclusive inside. */
class CustomPeriodModal extends Modal {
  private onPick: (period: BillingPeriod | null) => void;
  private fromValue: string;
  private toValue: string;

  constructor(app: App, now: number, onPick: (period: BillingPeriod | null) => void) {
    super(app);
    this.onPick = onPick;
    const month = monthPeriod(now);
    this.fromValue = isoDate(month.from);
    this.toValue = isoDate(month.to - 1);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Custom billing period" });

    new Setting(contentEl).setName("From").setDesc("First day billed (YYYY-MM-DD).").addText((t) =>
      t.setValue(this.fromValue).onChange((v) => (this.fromValue = v.trim()))
    );
    new Setting(contentEl).setName("To").setDesc("Last day billed, inclusive.").addText((t) =>
      t.setValue(this.toValue).onChange((v) => (this.toValue = v.trim()))
    );

    const error = contentEl.createDiv({ cls: "tti-error" });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Use this period")
        .setCta()
        .onClick(() => {
          const from = parseLocalDate(this.fromValue);
          const toInclusive = parseLocalDate(this.toValue);
          if (from === null || toInclusive === null) {
            error.setText("Both dates must be in YYYY-MM-DD form.");
            return;
          }
          // Exclusive end: the next local midnight after the last billed day.
          // Adding 24 hours is wrong across a daylight-saving transition.
          const to = nextLocalMidnight(toInclusive);
          if (to <= from) {
            error.setText("The end date must not be before the start date.");
            return;
          }
          this.close();
          this.onPick({ from, to, label: `${isoDate(from)} to ${isoDate(to - 1)}` });
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


/**
 * Show exactly what is about to be billed before anything is written.
 * Nothing is issued until this is confirmed — including, deliberately, when
 * the draft is empty or every line rounded to zero.
 */
export class ConfirmInvoiceModal extends Modal {
  private draft: InvoiceDraft;
  private meta: { client: string; number: string; currency: string; periodLabel: string | null };
  private onConfirm: () => void;

  constructor(
    app: App,
    draft: InvoiceDraft,
    meta: { client: string; number: string; currency: string; periodLabel: string | null },
    onConfirm: () => void
  ) {
    super(app);
    this.draft = draft;
    this.meta = meta;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("tti-confirm");
    contentEl.createEl("h3", { text: `Invoice ${this.meta.number} — ${this.meta.client}` });
    contentEl.createEl("p", {
      text: this.meta.periodLabel
        ? `Period ${this.meta.periodLabel}`
        : "All time not yet allocated to an invoice.",
      cls: "tti-confirm-sub",
    });

    if (this.draft.lines.length === 0) {
      contentEl.createEl("p", {
        text: "There is nothing left to bill for this client in this period.",
      });
      new Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }

    if (this.draft.totalMinor <= 0) {
      // Issuing would consume the hours and bill nothing for them, with no way
      // to get them back except voiding. Refuse rather than offer it.
      contentEl.createEl("p", {
        text:
          "Every line rounds to zero hours at the current billing increment, so this invoice " +
          "would be for nothing while marking the time as billed. Lower the rounding increment " +
          "in settings, or track more time against this client first.",
      });
      for (const warning of this.draft.warnings) {
        contentEl.createDiv({ text: warning, cls: "tti-warning" });
      }
      new Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }

    const table = contentEl.createEl("table", { cls: "tti-confirm-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const label of ["Description", "Hours", "Amount"]) {
      head.createEl("th", { text: label });
    }
    const body = table.createEl("tbody");
    for (const line of this.draft.lines) {
      const row = body.createEl("tr");
      row.createEl("td", { text: line.description });
      row.createEl("td", { text: formatHours(line.seconds) });
      row.createEl("td", { text: formatMoney(line.amountMinor, this.meta.currency) });
    }
    const foot = table.createEl("tfoot").createEl("tr");
    foot.createEl("th", { text: "Total" });
    foot.createEl("th", { text: formatHours(this.draft.totalSeconds) });
    foot.createEl("th", { text: formatMoney(this.draft.totalMinor, this.meta.currency) });

    for (const warning of this.draft.warnings) {
      contentEl.createDiv({ text: warning, cls: "tti-warning" });
    }

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText("Issue invoice")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      )
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Pick an issued invoice, for voiding. */
export class InvoicePickModal extends FuzzySuggestModal<{
  id: string;
  number: string;
  client: string;
  label: string;
}> {
  private items: { id: string; number: string; client: string; label: string }[];
  private onPick: (id: string) => void;

  constructor(
    app: App,
    items: { id: string; number: string; client: string; label: string }[],
    onPick: (id: string) => void
  ) {
    super(app);
    this.items = items;
    this.onPick = onPick;
    this.setPlaceholder("Select an invoice to void…");
  }

  getItems(): { id: string; number: string; client: string; label: string }[] {
    return this.items;
  }

  getItemText(item: { label: string }): string {
    return item.label;
  }

  onChooseItem(item: { id: string }): void {
    this.onPick(item.id);
  }
}
