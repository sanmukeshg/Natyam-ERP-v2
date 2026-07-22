/* ============================================================================
   NATYAM ERP 2.0 — DESIGN TOKENS
   ----------------------------------------------------------------------------
   Single source of truth. No component file may declare a raw hex, px radius,
   shadow or duration. If a value is needed and missing, add it here first.

   PALETTE RATIONALE
   Kuchipudi's stage vocabulary is three colours: the deep indigo of Krishna,
   the terracotta of temple brick, and the gold of the costume border. The
   1.0 build used terracotta as the whole interface, which reads warm for a
   marketing page and exhausting for a registrar who is in this app for six
   hours a day. 2.0 inverts the weighting: cool neutral surfaces carry the
   work, indigo carries the chrome, terracotta is reserved for action, gold
   appears only where the school's identity should be felt (brand, awards,
   certificates). Brand is preserved; its dosage is corrected.
   ============================================================================ */

:root {
    color-scheme: light;

    /* ---------------------------------------------------------------- BRAND */
    --brand-indigo-50:  #EEF1F8;
    --brand-indigo-100: #D6DDEE;
    --brand-indigo-200: #AEBBDA;
    --brand-indigo-300: #7C8DBC;
    --brand-indigo-400: #4D6099;
    --brand-indigo-500: #2F4478;
    --brand-indigo-600: #22335D;
    --brand-indigo-700: #1A2747;
    --brand-indigo-800: #131C34;
    --brand-indigo-900: #0D1424;

    --brand-terracotta-50:  #FCF0EC;
    --brand-terracotta-100: #F7DAD1;
    --brand-terracotta-200: #EFB4A4;
    --brand-terracotta-300: #E08A72;
    --brand-terracotta-400: #CE6B4E;
    --brand-terracotta-500: #C05C3E;
    --brand-terracotta-600: #A2482E;
    --brand-terracotta-700: #813724;
    --brand-terracotta-800: #5E281B;

    --brand-gold-100: #F7EFE5;
    --brand-gold-300: #E4C79E;
    --brand-gold-500: #D4A373;
    --brand-gold-700: #A87D51;

    /* -------------------------------------------------------------- NEUTRAL */
    /* Cool-neutral, very slightly blue. Reads as paper under office light and
       keeps long tabular sessions calm. */
    --neutral-0:   #FFFFFF;
    --neutral-25:  #FBFCFD;
    --neutral-50:  #F6F8FA;
    --neutral-100: #EDF0F4;
    --neutral-200: #DFE4EB;
    --neutral-300: #C7CFDA;
    --neutral-400: #9AA5B5;
    --neutral-500: #6F7C8E;
    --neutral-600: #55606F;
    --neutral-700: #3D4653;
    --neutral-800: #29303A;
    --neutral-900: #171C24;

    /* ------------------------------------------------------------- SEMANTIC */
    --success-50:  #E9F5EF;
    --success-100: #C9E7D8;
    --success-500: #2A7B5F;
    --success-600: #206049;
    --success-700: #164936;

    --warning-50:  #FDF3E2;
    --warning-100: #F8E2BA;
    --warning-500: #B57A16;
    --warning-600: #8F5F0F;
    --warning-700: #6E490B;

    --danger-50:   #FCEBE8;
    --danger-100:  #F7CFC8;
    --danger-500:  #BA3C2A;
    --danger-600:  #9A2D1E;
    --danger-700:  #782317;

    --info-50:     #E8F1FB;
    --info-100:    #C8DDF5;
    --info-500:    #2563AF;
    --info-600:    #1C4D8A;
    --info-700:    #153B6B;

    /* ---------------------------------------------------- SEMANTIC SURFACES */
    /* Components reference these, never the raw ramps above. Dark theme only
       has to reassign this block. */
    --surface-canvas:      var(--neutral-50);
    --surface-raised:      var(--neutral-0);
    --surface-sunken:      var(--neutral-100);
    --surface-overlay:     var(--neutral-0);
    --surface-inverse:     var(--brand-indigo-800);
    --surface-hover:       var(--neutral-100);
    --surface-active:      var(--neutral-200);
    --surface-selected:    var(--brand-indigo-50);
    --surface-scrim:       rgba(13, 20, 36, 0.48);

    --border-subtle:       var(--neutral-200);
    --border-default:      var(--neutral-300);
    --border-strong:       var(--neutral-400);
    --border-inverse:      rgba(255, 255, 255, 0.14);

    --text-primary:        var(--neutral-900);
    --text-secondary:      var(--neutral-600);
    --text-tertiary:       var(--neutral-500);
    --text-disabled:       var(--neutral-400);
    --text-inverse:        var(--neutral-0);
    --text-inverse-muted:  rgba(255, 255, 255, 0.62);
    --text-link:           var(--brand-indigo-500);

    --accent:              var(--brand-terracotta-500);
    --accent-hover:        var(--brand-terracotta-600);
    --accent-active:       var(--brand-terracotta-700);
    --accent-subtle:       var(--brand-terracotta-50);
    --accent-border:       var(--brand-terracotta-200);
    --accent-text:         var(--brand-terracotta-700);

    --focus-ring:          var(--brand-indigo-400);

    /* ----------------------------------------------------------- TYPOGRAPHY */
    /* Offline-first: the app must run from a cold cache with no network, so no
       webfont CDN. These stacks resolve to a good face on every target OS.
       Self-hosted woff2 can be dropped in later without touching components. */
    --font-ui: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system,
               "Helvetica Neue", "Noto Sans", "Noto Sans Telugu", sans-serif;
    --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia,
               "Noto Serif", serif;
    --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono",
               "Roboto Mono", Menlo, Consolas, monospace;

    /* 1.200 minor-third scale from a 14px UI base. ERPs read at 14, not 16:
       the density is the point. */
    --text-2xs:  0.6875rem;  /* 11px — table meta, chart axes           */
    --text-xs:   0.75rem;    /* 12px — labels, badges, captions         */
    --text-sm:   0.8125rem;  /* 13px — table cells, secondary body      */
    --text-base: 0.875rem;   /* 14px — default UI text                  */
    --text-md:   1rem;       /* 16px — card titles                      */
    --text-lg:   1.125rem;   /* 18px — section headings                 */
    --text-xl:   1.375rem;   /* 22px — page titles                      */
    --text-2xl:  1.75rem;    /* 28px — KPI figures                      */
    --text-3xl:  2.25rem;    /* 36px — hero figures                     */

    --weight-regular:  400;
    --weight-medium:   500;
    --weight-semibold: 600;
    --weight-bold:     700;

    --leading-tight:   1.2;
    --leading-snug:    1.35;
    --leading-normal:  1.55;
    --leading-relaxed: 1.7;

    --tracking-tight:  -0.011em;
    --tracking-normal: 0;
    --tracking-wide:   0.02em;
    --tracking-caps:   0.06em;

    /* --------------------------------------------------------------- SPACE */
    /* 4px base grid. Every margin, padding and gap comes from here. */
    --space-0:  0;
    --space-1:  0.25rem;   /*  4 */
    --space-2:  0.5rem;    /*  8 */
    --space-3:  0.75rem;   /* 12 */
    --space-4:  1rem;      /* 16 */
    --space-5:  1.25rem;   /* 20 */
    --space-6:  1.5rem;    /* 24 */
    --space-8:  2rem;      /* 32 */
    --space-10: 2.5rem;    /* 40 */
    --space-12: 3rem;      /* 48 */
    --space-16: 4rem;      /* 64 */
    --space-20: 5rem;      /* 80 */

    /* --------------------------------------------------------------- SHAPE */
    --radius-xs:   3px;
    --radius-sm:   5px;
    --radius-md:   8px;
    --radius-lg:   12px;
    --radius-xl:   16px;
    --radius-full: 999px;

    /* ----------------------------------------------------------- ELEVATION */
    /* Tinted with the indigo hue rather than pure black so shadows sit in the
       same colour family as the chrome. */
    --shadow-xs: 0 1px 2px rgba(19, 28, 52, 0.06);
    --shadow-sm: 0 1px 3px rgba(19, 28, 52, 0.08), 0 1px 2px rgba(19, 28, 52, 0.04);
    --shadow-md: 0 4px 12px rgba(19, 28, 52, 0.09), 0 2px 4px rgba(19, 28, 52, 0.04);
    --shadow-lg: 0 12px 28px rgba(19, 28, 52, 0.13), 0 4px 8px rgba(19, 28, 52, 0.05);
    --shadow-xl: 0 24px 56px rgba(19, 28, 52, 0.18), 0 8px 16px rgba(19, 28, 52, 0.06);
    --shadow-focus: 0 0 0 3px rgba(77, 96, 153, 0.28);
    --shadow-focus-danger: 0 0 0 3px rgba(186, 60, 42, 0.24);

    /* --------------------------------------------------------------- MOTION */
    --duration-instant: 80ms;
    --duration-fast:    140ms;
    --duration-normal:  220ms;
    --duration-slow:    360ms;

    --ease-standard:  cubic-bezier(0.2, 0, 0.15, 1);
    --ease-entrance:  cubic-bezier(0.05, 0.7, 0.1, 1);
    --ease-exit:      cubic-bezier(0.3, 0, 0.8, 0.15);
    --ease-spring:    cubic-bezier(0.34, 1.4, 0.64, 1);

    /* ---------------------------------------------------------------- LAYER */
    --z-base:      0;
    --z-sticky:    100;
    --z-sidebar:   200;
    --z-header:    250;
    --z-dropdown:  400;
    --z-drawer:    500;
    --z-modal:     600;
    --z-palette:   700;
    --z-toast:     800;
    --z-boot:      900;

    /* --------------------------------------------------------------- LAYOUT */
    --sidebar-width:            256px;
    --sidebar-width-collapsed:  60px;
    --header-height:            56px;
    --subheader-height:         44px;
    --content-max:              1600px;
    --content-pad:              var(--space-6);
    --tap-target:               44px;

    /* ------------------------------------------------------------ DATA VIZ */
    /* Ordered for categorical series. Checked for distinguishability under
       deuteranopia and protanopia. */
    --chart-1: #2F4478;
    --chart-2: #C05C3E;
    --chart-3: #2A7B5F;
    --chart-4: #B57A16;
    --chart-5: #6F7C8E;
    --chart-6: #7C8DBC;
    --chart-grid: var(--neutral-200);
    --chart-axis: var(--neutral-400);
}

/* ============================================================================
   DARK THEME
   Only the semantic surface block is reassigned. Nothing else moves, which is
   the whole reason components are forbidden from touching the raw ramps.
   ============================================================================ */
[data-theme="dark"] {
    color-scheme: dark;

    --surface-canvas:   #0F1319;
    --surface-raised:   #171C24;
    --surface-sunken:   #0A0D12;
    --surface-overlay:  #1D242E;
    --surface-inverse:  #29303A;
    --surface-hover:    #222932;
    --surface-active:   #2B333E;
    --surface-selected: #1B2438;
    --surface-scrim:    rgba(0, 0, 0, 0.66);

    --border-subtle:    #262E39;
    --border-default:   #333C49;
    --border-strong:    #45505F;
    --border-inverse:   rgba(255, 255, 255, 0.1);

    --text-primary:       #E8ECF2;
    --text-secondary:     #A3AEBE;
    --text-tertiary:      #7C8798;
    --text-disabled:      #5A6474;
    --text-inverse:       #171C24;
    --text-inverse-muted: rgba(23, 28, 36, 0.66);
    --text-link:          #8FA6DC;

    --accent:        #D97A5C;
    --accent-hover:  #E58F73;
    --accent-active: #EFA88F;
    --accent-subtle: #2A1D18;
    --accent-border: #5E3A2C;
    --accent-text:   #EFA88F;

    --focus-ring:    #7C8DBC;

    --success-50:  #10241C;
    --success-100: #1A3A2C;
    --success-500: #4FB98D;

    --warning-50:  #251C0C;
    --warning-100: #3D2E13;
    --warning-500: #D9A343;

    --danger-50:   #2A1210;
    --danger-100:  #431C18;
    --danger-500:  #E4705C;

    --info-50:     #101F31;
    --info-100:    #17304C;
    --info-500:    #5C9BE0;

    /*
     * The 600 and 700 shades are *text* colours. In the light theme they are
     * deep enough to read on a pale tint; left unchanged in dark they become
     * near-black type on a dark surface — which is precisely the state the
     * status text, tone utilities and notice icons were in. Dark inverts the
     * ramp: the readable shade is now lighter than the 500, not darker.
     */
    --success-600: #6FCCA4;
    --success-700: #8FDBBB;
    --warning-600: #E8BC6B;
    --warning-700: #F0CE8F;
    --danger-600:  #F0907E;
    --danger-700:  #F5AC9E;
    --info-600:    #85B6EA;
    --info-700:    #A6CBF1;

    --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.4);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.45), 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5), 0 2px 4px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 12px 28px rgba(0, 0, 0, 0.55), 0 4px 8px rgba(0, 0, 0, 0.35);
    --shadow-xl: 0 24px 56px rgba(0, 0, 0, 0.6), 0 8px 16px rgba(0, 0, 0, 0.4);

    --chart-1: #7C8DBC;
    --chart-2: #D97A5C;
    --chart-3: #4FB98D;
    --chart-4: #D9A343;
    --chart-5: #9AA5B5;
    --chart-6: #AEBBDA;
    --chart-grid: #262E39;
    --chart-axis: #55606F;
}

/* ============================================================================
   DENSITY
   Registrars marking 80 students want rows tight. Guests reviewing a report
   want them open. One attribute on <html> switches the whole table system.
   ============================================================================ */
[data-density="compact"] {
    --row-height:  32px;
    --cell-pad-y:  var(--space-1);
    --cell-pad-x:  var(--space-3);
    --control-height: 30px;
    --content-pad: var(--space-4);
}

[data-density="comfortable"] {
    --row-height:  44px;
    --cell-pad-y:  var(--space-3);
    --cell-pad-x:  var(--space-4);
    --control-height: 36px;
}

[data-density="spacious"] {
    --row-height:  56px;
    --cell-pad-y:  var(--space-4);
    --cell-pad-x:  var(--space-5);
    --control-height: 42px;
}

/* Default density if the attribute is absent for any reason. */
:root {
    --row-height:  44px;
    --cell-pad-y:  var(--space-3);
    --cell-pad-x:  var(--space-4);
    --control-height: 36px;
}

/* Touch devices get larger hit areas regardless of the chosen density. */
@media (pointer: coarse) {
    :root {
        --row-height: 52px;
        --control-height: 44px;
    }
}
