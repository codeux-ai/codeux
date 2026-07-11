import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsMergeGatesAutofixContent from '../content/docs/settings-merge-gates-autofix.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-merge-gates-autofix')({
  component: () => (
    <DocsPage id="settings-merge-gates-autofix">
      <SettingsMergeGatesAutofixContent />
    </DocsPage>
  )
})
