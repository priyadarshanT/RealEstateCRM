import type { Schemas } from '@crm/contracts';
import type { ChartOption as EChartsOption } from '@crm/ui/chart';

// ECharts options for the dashboard (SRS §10.2–10.4). Colors follow the wireframe.

export const PALETTE = ['#0f8a7e', '#3b6fe0', '#f2b33d', '#8b5cf6', '#e0596b', '#14b8a6', '#64748b', '#f97316'];

type Bucket = Schemas['CountBucket'];

export function pieOption(buckets: Bucket[]): EChartsOption {
  return {
    color: PALETTE,
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, type: 'scroll', textStyle: { fontSize: 11 } },
    series: [
      {
        type: 'pie',
        radius: ['0%', '68%'],
        center: ['50%', '44%'],
        label: { show: false },
        data: buckets.map((b) => ({ name: b.label, value: b.count })),
      },
    ],
  };
}

export function funnelOption(buckets: Bucket[]): EChartsOption {
  const steps = [...buckets].reverse();
  return {
    grid: { left: 80, right: 40, top: 8, bottom: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', data: steps.map((b) => b.label), axisTick: { show: false }, axisLine: { show: false } },
    series: [
      {
        type: 'bar',
        data: steps.map((b) => b.count),
        barWidth: 14,
        itemStyle: { color: '#0f8a7e', borderRadius: 4 },
        label: { show: true, position: 'right', fontSize: 11 },
      },
    ],
  };
}

export function barOption(buckets: Bucket[], color = '#3b6fe0'): EChartsOption {
  return {
    grid: { left: 36, right: 12, top: 12, bottom: 40 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: buckets.map((b) => b.label), axisLabel: { interval: 0, rotate: buckets.length > 5 ? 30 : 0, fontSize: 11 } },
    yAxis: { type: 'value', minInterval: 1 },
    series: [{ type: 'bar', data: buckets.map((b) => b.count), barMaxWidth: 32, itemStyle: { color, borderRadius: [4, 4, 0, 0] } }],
  };
}

export function trendOption(trend: Schemas['Dashboard']['trend']): EChartsOption {
  const dates = (trend ?? []).map((t) => t.date ?? '');
  return {
    color: PALETTE,
    grid: { left: 40, right: 48, top: 30, bottom: 28 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    xAxis: { type: 'category', data: dates },
    yAxis: [
      { type: 'value', minInterval: 1, name: 'Leads' },
      { type: 'value', name: 'AED', splitLine: { show: false } },
    ],
    series: [
      { name: 'Leads', type: 'line', smooth: true, data: (trend ?? []).map((t) => t.leads) },
      { name: 'Qualified', type: 'line', smooth: true, data: (trend ?? []).map((t) => t.qualified) },
      { name: 'Spend', type: 'line', smooth: true, yAxisIndex: 1, data: (trend ?? []).map((t) => Number(t.spend)) },
      { name: 'Sales', type: 'line', smooth: true, yAxisIndex: 1, data: (trend ?? []).map((t) => Number(t.sales)) },
    ],
  };
}
