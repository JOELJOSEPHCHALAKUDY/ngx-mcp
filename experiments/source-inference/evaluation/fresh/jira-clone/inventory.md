# jira-clone independent operation inventory

https://github.com/trungk18/jira-clone-angular @ `20b50e9a1a4d9205af4641b66f544b81cd46873e`

* `issue-create`: AddIssueModalComponent.submitForm — Upsert a newly identified issue into project issues; set status Backlog and timestamps, then close create modal.
* `issue-title-update`: IssueTitleComponent.onBlur — Replace current issue title on blur and update updatedAt.
* `issue-description-update`: IssueDescriptionComponent.save — Replace issue rich-text description and leave edit mode.
* `issue-priority-update`: IssuePriorityComponent.updateIssue — Replace current issue priority and update updatedAt.
* `issue-type-update`: IssueTypeComponent.updateIssue — Replace current issue type and update updatedAt.
* `issue-status-update`: IssueStatusComponent.updateIssue — Move current issue to selected status and set listPosition to last destination position plus one.
* `issue-assignee-add`: IssueAssigneesComponent.addUserToIssue — Append selected user.id to current issue.userIds.
* `issue-assignee-remove`: IssueAssigneesComponent.removeUser — Filter selected userId out of current issue.userIds.
* `issue-reporter-update`: IssueReporterComponent.updateIssue — Replace current issue reporterId with selected user.id.
* `issue-comment-add`: IssueCommentComponent.addComment — Append a timestamp-identified comment to current issue and reset draft editor.
* `issue-delete`: IssueDeleteModalComponent.deleteIssue — Emit DeleteIssueModel; modal or full-page parent deletes issue from store and closes dialogs/navigates.
* `board-issue-reorder`: BoardDndListComponent.drop — Within one status column, reorder rows and write one-based listPosition values to all destination rows.
* `board-issue-move`: BoardDndListComponent.drop — Transfer dragged issue to another column and update status; destination list positions written before final original-issue upsert.
* `project-settings-update`: SettingsComponent.submitForm — Merge edited project metadata into Akita project state and show success notification.

## Exclusions

* board-search-and-filters: searchControl valueChanges, userChanged, ignoreResolvedChanged, onlyMyIssueChanged and resetAll update ephemeral FilterStore rather than issues/project business data. They remain useful runtime setup but are excluded uniformly from business-action denominator.
* create-modal-select-drafts: Issue type, priority, reporter and assignee select child callbacks update only issueForm controls; domain mutation occurs once at AddIssueModalComponent.submitForm.
* issue-description-edit-cancel: setEditMode, editorCreated and cancel control draft editing/focus, without store mutation.
* comment-edit-and-shortcut: setCommentEdit, keyEvent and cancelAddComment change draft/focus; no edit-existing-comment or delete-comment control is implemented.
* dialogs-navigation-layout: Open/close create/delete/detail/search dialogs, issue page expansion, navbar/sidebar resize, manualToggle, snow and external feedback links are presentation/navigation only. Final confirmation deletion is included.
* automatic-login-and-project-fetch: ProjectComponent.ngOnInit calls mock auth login and static getProject; automatic fixture loading is infrastructure rather than user-invoked business operation.
* unimplemented-time-tracking: JIssue interface declares estimate/timeSpent/timeRemaining but issue detail has no editor or user callback for them. These are not silently omitted reachable operations.

## Source and oracle notes

* All 14 domain-operation variants in the shipped app are included. Issue comments support add/read only, not edit/delete. Fields present solely in models are not presumed user actions.
* All edits are in-memory; refresh loss is expected. Domain operation classification does not imply persistence. No real login/account/backend is involved.
* Drag/drop callback contracts are CDK objects with reference identities. Normalized JSON payloads are explicitly adapter-level, not falsely claimed raw handler arguments.
* Create and settings forms have defaults. Only title/name need supplied non-whitespace values for a fresh form; semantic enum options remain constrained by visible controls.
* Source bug discovered independently: cross-column drop can restore moved issue old listPosition after reordering. Labels preserve actual behavior.
