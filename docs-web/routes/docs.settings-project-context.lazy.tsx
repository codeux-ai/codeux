import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsProjectContextContent from '../content/docs/settings-project-context.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-project-context')({
  component: () => (
    <DocsPage id="settings-project-context">
      <SettingsProjectContextContent />
    </DocsPage>
  )
})
