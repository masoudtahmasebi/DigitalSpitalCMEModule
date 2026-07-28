/**
 * The editor half of the block (P6-01).
 *
 * Deliberately not a live preview. Rendering the real widget in the editor
 * would mount a learner session inside wp-admin — reporting watch progress for
 * whoever is editing the page, against a course they may not be enrolled in.
 * The editor shows a placeholder and one field; the front end renders the
 * element.
 *
 * Written in plain ES with `wp.element.createElement` rather than JSX, so the
 * plugin has no build step of its own. A WordPress plugin that needs npm
 * before it can be reviewed is a plugin that does not get reviewed.
 */
(function (blocks, element, blockEditor, components, i18n) {
  var el = element.createElement;
  var __ = i18n.__;

  blocks.registerBlockType("ds-lms/course", {
    edit: function (props) {
      return el(
        "div",
        blockEditor.useBlockProps(),
        el(
          components.Placeholder,
          {
            icon: "welcome-learn-more",
            label: __("DS Education — Fortbildung", "ds-lms"),
            instructions: __(
              "Die Fortbildung wird auf der veröffentlichten Seite angezeigt. Leer lassen, um die Standard-Fortbildung aus den Einstellungen zu verwenden.",
              "ds-lms",
            ),
          },
          el(components.TextControl, {
            __nextHasNoMarginBottom: true,
            label: __("Fortbildung (Slug)", "ds-lms"),
            value: props.attributes.courseSlug,
            onChange: function (value) {
              props.setAttributes({ courseSlug: value });
            },
          }),
        ),
      );
    },
    // Rendered server-side by DS_LMS_Renderer::block, so the markup and the
    // configuration have exactly one source.
    save: function () {
      return null;
    },
  });
})(
  window.wp.blocks,
  window.wp.element,
  window.wp.blockEditor,
  window.wp.components,
  window.wp.i18n,
);
