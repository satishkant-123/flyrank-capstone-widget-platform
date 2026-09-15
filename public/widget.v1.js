(function () {
  'use strict';

  // Determine current script tag and configuration parameter
  const currentScript = document.currentScript || (function () {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  if (!currentScript) {
    console.error('[FlyRankWidget] Could not detect host script element');
    return;
  }

  const scriptUrl = new URL(currentScript.src, window.location.href);
  const widgetId = scriptUrl.searchParams.get('id') || currentScript.getAttribute('data-widget-id');
  const baseUrl = scriptUrl.origin;

  if (!widgetId) {
    console.error('[FlyRankWidget] Missing required widget "id" parameter in script src');
    return;
  }

  // Create isolated widget container
  const hostElement = document.getElementById('flyrank-widget') || (function () {
    const container = document.createElement('div');
    container.id = 'flyrank-widget-root';
    currentScript.parentNode.insertBefore(container, currentScript.nextSibling);
    return container;
  })();

  // Fetch widget configuration from public cached endpoint
  fetch(`${baseUrl}/api/widgets/${encodeURIComponent(widgetId)}/config`)
    .then(function (res) {
      if (!res.ok) throw new Error('Widget configuration could not be loaded (' + res.status + ')');
      return res.json();
    })
    .then(function (config) {
      renderWidget(config, hostElement, baseUrl);
    })
    .catch(function (err) {
      console.error('[FlyRankWidget] Initialization error:', err);
    });

  function renderWidget(config, container, apiOrigin) {
    const display = config.display_options || {};
    const isDark = display.theme === 'dark';
    const primaryColor = display.primary_color || '#4F46E5';

    const wrapper = document.createElement('div');
    wrapper.className = 'flyrank-widget-card';
    wrapper.style.cssText = [
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'max-width: 440px',
      'padding: 24px',
      'border-radius: 12px',
      'box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
      'background: ' + (isDark ? '#1F2937' : '#FFFFFF'),
      'color: ' + (isDark ? '#F9FAFB' : '#111827'),
      'border: 1px solid ' + (isDark ? '#374151' : '#E5E7EB'),
      'margin: 16px auto',
      'box-sizing: border-box'
    ].join(';');

    // Header
    const titleEl = document.createElement('h3');
    titleEl.textContent = config.title;
    titleEl.style.cssText = 'margin: 0 0 8px 0; font-size: 1.25rem; font-weight: 700;';
    wrapper.appendChild(titleEl);

    if (config.description) {
      const descEl = document.createElement('p');
      descEl.textContent = config.description;
      descEl.style.cssText = 'margin: 0 0 18px 0; font-size: 0.875rem; color: ' + (isDark ? '#9CA3AF' : '#6B7280') + '; line-height: 1.4;';
      wrapper.appendChild(descEl);
    }

    // Feedback notification box
    const feedbackBox = document.createElement('div');
    feedbackBox.style.display = 'none';
    feedbackBox.style.padding = '12px';
    feedbackBox.style.borderRadius = '8px';
    feedbackBox.style.marginBottom = '14px';
    feedbackBox.style.fontSize = '0.875rem';
    wrapper.appendChild(feedbackBox);

    // Form
    const form = document.createElement('form');
    form.noValidate = true;

    // Honeypot spam trap: completely hidden from humans, attractive to bots
    const honeypot = document.createElement('input');
    honeypot.type = 'text';
    honeypot.name = '_hp_website';
    honeypot.tabIndex = -1;
    honeypot.autocomplete = 'off';
    honeypot.style.cssText = 'position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; pointer-events: none;';
    form.appendChild(honeypot);

    // Render dynamic fields
    const fields = config.fields || [];
    fields.forEach(function (field) {
      const group = document.createElement('div');
      group.style.marginBottom = '14px';

      const label = document.createElement('label');
      label.textContent = field.label || field.name;
      label.style.cssText = 'display: block; font-size: 0.825rem; font-weight: 600; margin-bottom: 6px;';
      group.appendChild(label);

      const input = document.createElement('input');
      input.type = field.type || 'text';
      input.name = field.name;
      input.required = Boolean(field.required);
      input.placeholder = field.placeholder || '';
      input.style.cssText = [
        'width: 100%',
        'padding: 10px 12px',
        'border-radius: 6px',
        'border: 1px solid ' + (isDark ? '#4B5563' : '#D1D5DB'),
        'background: ' + (isDark ? '#374151' : '#F9FAFB'),
        'color: ' + (isDark ? '#FFFFFF' : '#111827'),
        'font-size: 0.9rem',
        'box-sizing: border-box',
        'outline: none'
      ].join(';');

      group.appendChild(input);
      form.appendChild(group);
    });

    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = config.button_text || 'Submit';
    submitBtn.style.cssText = [
      'width: 100%',
      'padding: 11px 16px',
      'border-radius: 6px',
      'background: ' + primaryColor,
      'color: #FFFFFF',
      'font-weight: 600',
      'font-size: 0.95rem',
      'border: none',
      'cursor: pointer',
      'transition: opacity 0.2s ease',
      'margin-top: 4px'
    ].join(';');
    form.appendChild(submitBtn);

    // Form submission handling
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      feedbackBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';
      submitBtn.textContent = 'Submitting...';

      const formData = {};
      fields.forEach(function (f) {
        const inputEl = form.elements[f.name];
        if (inputEl) {
          formData[f.name] = inputEl.value.trim();
        }
      });

      const payload = {
        widget_id: config.id,
        data: formData,
        _hp_website: honeypot.value
      };

      fetch(apiOrigin + '/api/submissions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, status: res.status, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            throw new Error(result.data.error || 'Submission failed (' + result.status + ')');
          }

          form.style.display = 'none';
          feedbackBox.style.display = 'block';
          feedbackBox.style.background = isDark ? '#064E3B' : '#ECFDF5';
          feedbackBox.style.color = isDark ? '#A7F3D0' : '#065F46';
          feedbackBox.style.border = '1px solid ' + (isDark ? '#059669' : '#A7F3D0');
          feedbackBox.innerHTML = '<strong>Success!</strong> Thank you for your submission.';
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          submitBtn.textContent = config.button_text || 'Submit';

          feedbackBox.style.display = 'block';
          feedbackBox.style.background = isDark ? '#7F1D1D' : '#FEF2F2';
          feedbackBox.style.color = isDark ? '#FCA5A5' : '#991B1B';
          feedbackBox.style.border = '1px solid ' + (isDark ? '#DC2626' : '#FECACA');
          feedbackBox.textContent = err.message;
        });
    });

    wrapper.appendChild(form);
    container.innerHTML = '';
    container.appendChild(wrapper);
  }
})();
