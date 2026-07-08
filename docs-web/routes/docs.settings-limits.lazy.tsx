import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsLimitsContent from '../content/docs/settings-limits.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-limits')({
  component: () => (
    <DocsPage id="settings-limits">
      <SettingsLimitsContent />
    </DocsPage>
  )
})
