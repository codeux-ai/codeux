import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsGuidanceContent from '../content/docs/settings-guidance.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-guidance')({
  component: () => (
    <DocsPage id="settings-guidance">
      <SettingsGuidanceContent />
    </DocsPage>
  )
})
