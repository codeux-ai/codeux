import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsRuntimeLimitsContent from '../content/docs/settings-runtime-limits.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-runtime-limits')({
  component: () => (
    <DocsPage id="settings-runtime-limits">
      <SettingsRuntimeLimitsContent />
    </DocsPage>
  )
})
