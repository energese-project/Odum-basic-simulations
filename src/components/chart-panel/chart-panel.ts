import { BaseComponent } from '../../core/base-component.ts';
import { seriesColours, token } from '../../core/theme.ts';
import { thinPlot, type Plot } from '../../basic/output.ts';
import template from './chart-panel.html?raw';
import style from './chart-panel.css?raw';

import {
  CategoryScale,
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartDataset,
} from 'chart.js';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend
);

/**
 * Past eight series the hues repeat, and the line style carries the difference
 * instead — the eight categorical slots are a validated set and a ninth hue
 * would be an invented one. See the header of styles/energese.css.
 */
const SERIES_DASHES: number[][] = [[], [6, 3], [2, 3], [8, 3, 2, 3]];

/**
 * The most rows the chart is drawn from — a few per pixel of a wide plot.
 * Chart.js re-parses every point on every update, and the plot is redrawn four
 * times a second while a program runs; see thinPlot for what is kept.
 */
const MAX_ROWS = 4000;

export class ChartPanelComponent extends BaseComponent {
  static tagName = 'chart-panel';

  private chart: Chart<'line'> | null = null;
  private plot: Plot | null = null;
  private onThemeChanged = (): void => this.restyle();

  constructor() {
    super(template, style);
  }

  init(): void {
    // A <canvas> is pixels, so unlike everything else on the page it does not
    // follow the tokens on its own. This is the only reason theme-changed exists.
    window.addEventListener('theme-changed', this.onThemeChanged);
  }

  disconnectedCallback(): void {
    window.removeEventListener('theme-changed', this.onThemeChanged);
    this.chart?.destroy();
    this.chart = null;
  }

  show(plot: Plot | null): void {
    // The same plot, grown in place while the program runs (see TableReader):
    // new rows, same series, so only the data changes.
    if (plot !== null && plot === this.plot && this.chart) {
      const drawn = thinPlot(plot, MAX_ROWS);
      this.chart.data.datasets.forEach((ds, i) => (ds.data = drawn.series[i].points));
      this.chart.update('none');
      return;
    }

    this.plot = plot;
    const empty = this.querySelector<HTMLElement>('.empty');
    const wrap = this.querySelector<HTMLElement>('.canvas-wrap');
    const canvas = this.querySelector('canvas');
    if (!empty || !wrap || !canvas) return;

    if (!plot) {
      this.chart?.destroy();
      this.chart = null;
      wrap.hidden = true;
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    wrap.hidden = false;

    const datasets = this.datasets(thinPlot(plot, MAX_ROWS));
    if (this.chart) {
      this.chart.data.datasets = datasets;
      this.chart.options.scales!.x!.title = { display: true, text: plot.xLabel };
      this.chart.update('none');
      this.restyle();
      return;
    }

    this.chart = new Chart<'line'>(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // A run is tens of thousands of points; animating it is a frozen tab.
        animation: false,
        // The crosshair-and-tooltip behaviour a line chart should have by
        // default: hovering anywhere in the plot reports every series at that x,
        // rather than requiring the pointer to land on a mark.
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: plot.xLabel },
          },
          // Deliberately one y axis. Columns of different magnitude — a storage
          // in the thousands beside a flow in the tens — share it and the
          // smaller one reads as flat, which is the true relationship. A second
          // scale would make them look comparable when they are not.
          y: { type: 'linear' },
        },
        plugins: {
          legend: {
            // One series is named by the axis title; a legend box for it is
            // furniture. Two or more always need one.
            display: plot.series.length > 1,
            position: 'bottom',
            labels: { usePointStyle: true, boxHeight: 8, padding: 14 },
          },
        },
      },
    });
    this.restyle();
  }

  private datasets(plot: Plot): ChartDataset<'line', { x: number; y: number }[]>[] {
    const colours = seriesColours();
    return plot.series.map((s, i) => ({
      label: s.label,
      data: s.points,
      borderColor: colours[i % colours.length],
      backgroundColor: colours[i % colours.length],
      borderDash: SERIES_DASHES[Math.floor(i / colours.length) % SERIES_DASHES.length],
      borderWidth: 2,
      // No marker on every sample — at this density they would merge into a
      // band. The hover layer still resolves a point per series per x.
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0,
    }));
  }

  /** Re-read the tokens and repaint. Called on every theme change. */
  private restyle(): void {
    if (!this.chart || !this.plot) return;

    const colours = seriesColours();
    this.chart.data.datasets.forEach((ds, i) => {
      ds.borderColor = colours[i % colours.length];
      ds.backgroundColor = colours[i % colours.length];
    });

    const ink = token('--e-ink');
    const muted = token('--e-muted');
    const grid = token('--e-grid');
    const axis = token('--e-axis');
    const tick = token('--e-tick');
    const surface = token('--e-surface');

    for (const scale of [this.chart.options.scales!.x!, this.chart.options.scales!.y!]) {
      // Recessive: the data is the figure, the grid is the ground.
      scale.grid = { color: grid, drawTicks: false };
      scale.border = { color: axis };
      scale.ticks = { color: tick, padding: 6 };
      if (scale.title) scale.title.color = muted;
    }

    const legend = this.chart.options.plugins!.legend!;
    // Text wears ink, never the series colour; the swatch beside it carries identity.
    legend.labels = { ...legend.labels, color: ink };

    this.chart.options.plugins!.tooltip = {
      backgroundColor: surface,
      titleColor: ink,
      bodyColor: muted,
      borderColor: token('--e-rule'),
      borderWidth: 1,
      padding: 10,
      usePointStyle: true,
    };

    this.chart.update('none');
  }
}

if (!customElements.get(ChartPanelComponent.tagName)) {
  customElements.define(ChartPanelComponent.tagName, ChartPanelComponent);
}
