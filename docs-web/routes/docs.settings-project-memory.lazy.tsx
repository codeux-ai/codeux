import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsProjectMemoryContent from '../content/docs/settings-project-memory.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-project-memory')({
  component: () => (
    <DocsPage id="settings-project-memory">
      <SettingsProjectMemoryContent />
    </DocsPage>
  )
})
