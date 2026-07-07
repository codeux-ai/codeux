import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesProjectMarkdownMirrorContent from '../content/docs/settings-subcategories-project-markdown-mirror.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-project-markdown-mirror')({
  component: () => (
    <DocsPage id="settings-subcategories-project-markdown-mirror">
      <SettingsSubcategoriesProjectMarkdownMirrorContent />
    </DocsPage>
  )
})
