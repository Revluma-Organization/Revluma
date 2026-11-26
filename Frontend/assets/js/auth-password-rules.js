/* Shared password rule check for the auth pages. */
// Mirrors Backend/src/middlewares/validateAuth.js: 8+ chars, upper, lower, number, one of @$!%*?&
window.RV_PW_RULES = {
  length: (v) => v.length >= 8,
  upper: (v) => /[A-Z]/.test(v),
  lower: (v) => /[a-z]/.test(v),
  number: (v) => /\d/.test(v),
  symbol: (v) => /[@$!%*?&]/.test(v),
};
window.checkPasswordRules = function checkPasswordRules(value, list) {
  let ok = true;
  Object.keys(window.RV_PW_RULES).forEach((key) => {
    const pass = window.RV_PW_RULES[key](value);
    ok = ok && pass;
    const li = list && list.querySelector('[data-rule="' + key + '"]');
    if (li) li.classList.toggle('ok', pass);
  });
  return ok;
};
