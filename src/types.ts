import type {
  IBaseComponent,
  IConfigComponent,
  ILoggerComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import type { IFetchComponent, IHttpServerComponent } from '@dcl/core-commons'
import type { IPgComponent } from '@dcl/pg-component'
import type { ISchemaValidatorComponent } from '@dcl/schema-validator-component'
import type { ICmsDatabaseComponent } from './adapters/cms-db'
import type { IContentfulComponent } from './adapters/contentful/types'
import type { metricDeclarations } from './metrics'

export interface CmsConfig {
  contentfulSpaceId: string
  contentfulEnvironmentId: string
  contentfulAccessToken: string
}

export type { IPgComponent }

export interface GlobalContext {
  components: BaseComponents
}

// components used in every environment
export interface BaseComponents {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IHttpServerComponent<GlobalContext>
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  fetcher: IFetchComponent
  schemaValidator: ISchemaValidatorComponent<GlobalContext>
  cmsConfig: CmsConfig
  pg: IPgComponent
  cmsDb: ICmsDatabaseComponent
  contentful: IContentfulComponent
}

// components used in runtime
export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
}

// components used in tests
export type TestComponents = BaseComponents & {
  // A fetch component that only hits the test server, provided by @dcl/test-helpers.
  localFetch: IFetchComponent
}

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = string
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }>,
  Path
>

export type Context<Path extends string = string> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>
