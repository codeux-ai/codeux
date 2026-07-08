import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsOverviewContent from '../content/docs/settings-overview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-overview')({
  component: () => (
    <DocsPage id="settings-overview">
      <SettingsOverviewContent />
    </DocsPage>
  )
})
