---
description: Review code for internationalization compliance - detect hardcoded strings
---

# Internationalization (i18n) Review

Review code changes for proper internationalization. Detect hardcoded user-facing strings.

## Arguments

$ARGUMENTS

- `<path>` - File or directory to review
- `--fix` - Suggest fixes for detected issues

## Review Checklist

### 1. Hardcoded String Detection

Scan for user-facing text that should be translated:

**PHP Patterns to Flag:**
```php
// ❌ Hardcoded - MUST FIX
echo "Welcome to our site";
$error = "Invalid email address";
throw new Exception("User not found");
$label = 'Submit';

// ✅ Correct
echo __('messages.welcome');
$error = __('validation.email');
throw new Exception(__('errors.user_not_found'));
$label = Text::_('COM_MYAPP_BTN_SUBMIT');
```

**JavaScript/Vue Patterns to Flag:**
```javascript
// ❌ Hardcoded - MUST FIX
alert('Are you sure?');
element.textContent = 'Loading...';
const msg = "Success!";
<button>Save</button>
<p>Welcome to our application</p>

// ✅ Correct
alert(this.$t('confirm.delete'));
element.textContent = i18n.t('common.loading');
const msg = t('messages.success');
<button>{{ $t('common.save') }}</button>
<p>{{ $t('common.welcome') }}</p>
```

**HTML Patterns to Flag:**
```html
<!-- ❌ Hardcoded - MUST FIX -->
<label>Email Address</label>
<button>Submit</button>
<th>Name</th>
<option>Select an option</option>
placeholder="Enter your name"
title="Click to edit"

<!-- ✅ Should use translation -->
<label><?php echo __('form.email'); ?></label>
<label>{{ $t('form.email') }}</label>
```

### 2. Context-Aware Exceptions

**DO NOT flag these as hardcoded strings:**
- Log messages (often kept in English for debugging)
- Code comments
- Variable names and keys
- CSS class names
- HTML attributes that aren't user-visible (id, name, class)
- Technical identifiers (API endpoints, config keys)
- Test assertions with expected values
- Regex patterns

### 3. Framework Compliance

**Check correct translation function usage:**

| Framework | Function | Template |
|-----------|----------|----------|
| Laravel | `__()`, `trans()`, `trans_choice()` | `@lang()`, `{{ __() }}` |
| Symfony | `$translator->trans()` | `{{ 'key'\|trans }}` |
| Joomla | `Text::_()`, `Text::sprintf()` | `<?php echo Text::_(); ?>` |
| Vue | `$t()`, `t()` | `{{ $t('key') }}` |
| React | `t()`, `<Trans>` | `{t('key')}` |

### 4. Translation Key Quality

**Good key names:**
```
user.profile.title
validation.email.required
button.submit
error.not_found
```

**Bad key names:**
```
text1
msg
label_42
welcomeMessage  (should be snake_case or dot notation)
```

### 5. Pluralization Check

Verify plural forms are handled:
```php
// ❌ Wrong - doesn't handle plurals
$msg = $count . " items found";

// ✅ Correct
$msg = trans_choice('search.results', $count, ['count' => $count]);
// With: 'search.results' => '{0} No items|{1} :count item|[2,*] :count items'
```

### 6. Parameter Substitution

Check dynamic values use parameters:
```php
// ❌ Wrong - concatenation
$msg = "Hello, " . $name . "!";

// ✅ Correct - parameterized
$msg = __('greeting', ['name' => $name]);
// With: 'greeting' => 'Hello, :name!'
```

## Output Format

```markdown
## i18n Review Results

**Files Scanned:** 12
**Issues Found:** 7

### Critical (Must Fix)

| File | Line | Issue | Suggested Fix |
|------|------|-------|---------------|
| UserController.php | 45 | Hardcoded: "Invalid password" | `__('auth.invalid_password')` |
| edit.blade.php | 23 | Hardcoded: `<label>Name</label>` | `<label>{{ __('form.name') }}</label>` |

### Warnings

| File | Line | Issue |
|------|------|-------|
| Dashboard.vue | 89 | Possible hardcoded: "Loading..." | May be intentional, verify |

### Translation Keys Needed

Add these to your language files:

```php
// en/messages.php
'auth.invalid_password' => 'Invalid password',
'form.name' => 'Name',
```

### Summary

- Critical issues: 5 (hardcoded user-facing text)
- Warnings: 2 (needs verification)
- Passed: 147 strings properly translated
```

## When to Run

- **Always** during code review step
- **Before** merging any frontend or UI changes
- **After** adding new user-facing features

## Integration with Workflow

This review should run as part of the code review phase. Add to workflow after implementation:

```
Step 2: Code Review
  └── Includes i18n compliance check
```

Or as a dedicated step for UI-heavy features:
```
Step 2a: Code Review (logic)
Step 2b: i18n Review (translations)
```
