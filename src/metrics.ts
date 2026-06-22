import { IMetricsComponent } from '@well-known-components/interfaces'
import { metricDeclarations as logsMetricsDeclarations } from '@well-known-components/logger'
import { getDefaultHttpMetrics } from '@dcl/http-server'
import { validateMetricsDeclaration } from '@dcl/metrics'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...logsMetricsDeclarations,
  test_ping_counter: {
    help: 'Count calls to ping',
    type: IMetricsComponent.CounterType,
    labelNames: ['pathname']
  },
  cms_webhook_counter: {
    help: 'Count webhook events processed',
    type: IMetricsComponent.CounterType,
    labelNames: ['action', 'entry_type']
  },
  cms_blog_listing_counter: {
    help: 'Count blog listing requests',
    type: IMetricsComponent.CounterType,
    labelNames: ['type']
  },
  cms_entry_counter: {
    help: 'Count entry retrieval requests',
    type: IMetricsComponent.CounterType,
    labelNames: ['type', 'source']
  },
  cms_sync_counter: {
    help: 'Count sync operations',
    type: IMetricsComponent.CounterType,
    labelNames: ['type']
  }
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
