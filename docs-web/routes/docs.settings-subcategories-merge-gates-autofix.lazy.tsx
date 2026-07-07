import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesMergeGatesAutofixContent from '../content/docs/settings-subcategories-merge-gates-autofix.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-merge-gates-autofix')({
  component: () => (
    <DocsPage id="settings-subcategories-merge-gates-autofix">
      <SettingsSubcategoriesMergeGatesAutofixContent />
    </DocsPage>
  )
})
