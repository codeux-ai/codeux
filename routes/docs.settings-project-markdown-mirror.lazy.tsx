import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsProjectMarkdownMirrorContent from '../content/docs/settings-project-markdown-mirror.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-project-markdown-mirror')({
  component: () => (
    <DocsPage id="settings-project-markdown-mirror">
      <SettingsProjectMarkdownMirrorContent />
    </DocsPage>
  )
})
