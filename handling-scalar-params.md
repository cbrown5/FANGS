To add to claude.md and progress.md as a task.

This is how we will handle model scalars including N and number of groups. 

The most user-friendly approach is a small Model constants section in the main UI, not a separate file. The current app already has a clear pattern for simple numeric controls in settings.js and the settings area in index.html, so scalar data should follow that same interaction style.

My recommendation is:

Infer what is safe to infer automatically.
N should always be read from the number of rows in the uploaded data and shown as a locked or read-only field. Users should be able to see it, but not need to type it. Add note to pop-up to explain N is a reserved variable name to the user. 

Ask for the rest in a dedicated Model constants panel.
When the model references scalar symbols that are not CSV columns, show them as numeric inputs below the data upload or below the model editor. Label the section something like Model constants or Additional data. This matches how BUGS users think about these values: they are data, but not tabular columns.

The reason I would avoid plain free-text entry is that it scales badly once there are several constants, invites syntax mistakes, and is harder to validate. Individual numeric inputs with inline validation are simpler and more transparent.

A good UX would look like this:

N
Value: 50
Source: inferred from 50 data rows
State: read-only

J
Value: blank
Hint: required by model, not inferable from current data
State: editable

K
Value: blank
Hint: required by model, not inferable from current data
State: editable

That gives you a practical rule set:

Automatic:
N from row count
Potentially other trivial sizes if unambiguous

Manual:
Anything else the model needs and the app cannot infer confidently