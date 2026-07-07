import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesProjectContextContent from '../content/docs/settings-subcategories-project-context.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-project-context')({
  component: () => (
    <DocsPage id="settings-subcategories-project-context">
      <SettingsSubcategoriesProjectContextContent />
    </DocsPage>
  )
})
