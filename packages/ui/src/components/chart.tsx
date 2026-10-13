'use client';

import * as echarts from 'echarts';
import * as React from 'react';
import { cn } from '../lib/cn';

export type ChartOption = echarts.EChartsOption;

/** Apache ECharts in a resizing container. `option` is a plain ECharts option object. */
export function Chart({ option, className, onClickItem }: { option: ChartOption; className?: string; onClickItem?: (index: number) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const chart = React.useRef<echarts.ECharts | null>(null);
  const clickRef = React.useRef(onClickItem);
  clickRef.current = onClickItem;

  React.useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: 'svg' });
    chart.current = c;
    c.on('click', (p) => clickRef.current?.(p.dataIndex));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  React.useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} className={cn('h-56 w-full', className)} />;
}
