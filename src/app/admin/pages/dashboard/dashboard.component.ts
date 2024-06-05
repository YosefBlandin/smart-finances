import { Component } from '@angular/core';
import type { ECharts, EChartsOption } from 'echarts';
import {
  NgxEchartsDirective,
  provideEcharts,
  NgxEchartsModule,
  ThemeOption,
} from 'ngx-echarts';

@Component({
  selector: 'smart-dashboard',
  standalone: true,
  imports: [NgxEchartsDirective, NgxEchartsModule],
  providers: [provideEcharts()],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  private chartInstance!: ECharts;
  public theme: string | ThemeOption = {
    color: [
      '#b21ab4',
      '#6f0099',
      '#2a2073',
      '#0b5ea8',
      '#17aecc',
      '#b3b3ff',
      '#eb99ff',
      '#fae6ff',
      '#e6f2ff',
      '#eeeeee',
    ],

    title: {
      fontWeight: 'normal',
      color: '#00aecd',
    },

    visualMap: {
      color: [
        '#008891',
        '#009689',
        '#1ba274',
        '#57ab56',
        '#8cb031',
        '#c4af00',
        '#ffa600',
      ],
    },

    toolbox: {
      color: ['#00aecd', '#00aecd', '#00aecd', '#00aecd'],
    },

    tooltip: {
      backgroundColor: 'rgba(0,0,0,0.8)',
      textStyle: {
        color: '#fff',
      },
      axisPointer: {
        // Axis indicator, coordinate trigger effective
        type: 'line', // The default is a straight line： 'line' | 'shadow'
        lineStyle: {
          // Straight line indicator style settings
          color: '#00aecd',
          type: 'dashed',
        },
        crossStyle: {
          color: '#00aecd',
        },
        shadowStyle: {
          // Shadow indicator style settings
          color: 'rgba(200,200,200,0.3)',
        },
      },
    },

    // Area scaling controller
    dataZoom: {
      dataBackgroundColor: '#eee', // Data background color
      fillerColor: 'rgba(144,197,237,0.2)', // Fill the color
      handleColor: '#00aecd', // Handle color
    },

    timeline: {
      lineStyle: {
        color: '#00aecd',
      },
      controlStyle: {
        color: '#00aecd',
        borderColor: '00aecd',
      },
    },

    candlestick: {
      itemStyle: {
        color: '#00aecd',
        color0: '#a2d4e6',
      },
      lineStyle: {
        width: 1,
        color: '#00aecd',
        color0: '#a2d4e6',
      },
      areaStyle: {
        color: '#b21ab4',
        color0: '#0b5ea8',
      },
    },

    chord: {
      padding: 4,
      itemStyle: {
        color: '#b21ab4',
        borderWidth: 1,
        borderColor: 'rgba(128, 128, 128, 0.5)',
      },
      lineStyle: {
        color: 'rgba(128, 128, 128, 0.5)',
      },
      areaStyle: {
        color: '#0b5ea8',
      },
    },

    graph: {
      itemStyle: {
        color: '#b21ab4',
      },
      linkStyle: {
        color: '#2a2073',
      },
    },

    map: {
      itemStyle: {
        color: '#c12e34',
      },
      areaStyle: {
        color: '#ddd',
      },
      label: {
        color: '#c12e34',
      },
    },

    gauge: {
      axisLine: {
        lineStyle: {
          color: [
            [0.2, '#dddddd'],
            [0.8, '#00aecd'],
            [1, '#f5ccff'],
          ],
          width: 8,
        },
      },
    },
  };
  public loadingOptions: {
    text: string;
    color: string;
    textColor: string;
    maskColor: string;
    zlevel: number;
  } = {
    text: 'Cargando...',
    color: '#c23531',
    textColor: '#000',
    maskColor: 'rgba(255, 255, 255, 0.8)',
    zlevel: 0,
  };
  public options: EChartsOption = {
    title: {
      left: 'center',
      top: 20,
      textStyle: {
        color: '#000',
        fontWeight: 'bold',
      },
    },
    tooltip: {
      trigger: 'item',
      formatter: '{a} <br/>{b} : {c} ({d}%)',
    },
    visualMap: {
      show: false,
      min: 80,
      max: 600,
    },
    series: [
      {
        name: 'Servicios',
        type: 'pie',
        radius: '75%',
        center: ['50%', '50%'],
        data: [
          { value: 335, name: 'Autenticacion' },
          { value: 1210, name: 'Pago Movil' },
          { value: 274, name: 'Registro' },
          { value: 235, name: 'Recarga' },
          { value: 400, name: 'Transferencia' },
          { value: 335, name: 'Autenticacion' },
          { value: 310, name: 'Pago Movil' },
          { value: 274, name: 'Registro' },
          { value: 735, name: 'Recarga' },
          { value: 900, name: 'Transferencia' },
        ].sort((a, b) => a.value - b.value),
        roseType: 'radius',
        label: {
          color: 'rgba(50, 50, 50, 1)',
          fontWeight: 'lighter',
          fontSize: '0.6rem',
        },
        labelLine: {
          lineStyle: {
            color: '#000',
          },

          smooth: 0,
          length: 0.01,
          length2: 10,
        },

        animationType: 'scale',
        animationEasing: 'elasticOut',
        animationDelay: () => Math.random() * 600,
      },
    ],
  };

  onChartInit(e: ECharts) {
    this.chartInstance = e;
  }
}
