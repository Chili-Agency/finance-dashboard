<?php
/* Página "KPI scorecard" (admin). Incluída pelo index.php; o comportamento está em assets/kpi-scorecard.js. */
?>
            <section class="view" id="kpi-scorecard-view" aria-labelledby="page-title">
                <div class="section-intro">
                    <div>
                        <p class="eyebrow">Team performance</p>
                        <h2>KPI scorecard builder</h2>
                        <p class="section-copy">Same fields as the ClickUp scorecard subtask. Delivery and Time Tracking are filled from ClickUp for the review month; edit or type any value, and type the other KPIs. Scores, overall score and zone are calculated for you. Saved scorecards are what the n8n workflow will send to ClickUp.</p>
                    </div>
                </div>

                <form class="panel kpi-form" id="kpi-form" novalidate>
                    <div class="kpi-grid">
                        <label class="field"><span>Employee (ClickUp user)</span><select id="kpi-user"><option value="">Loading users…</option></select></label>
                        <label class="field"><span>Review month</span><input type="month" id="kpi-month" required></label>
                        <label class="field"><span>Department (manual)</span><select id="kpi-service" required><option value="">Choose…</option><option value="SEO">SEO</option><option value="PPC">PPC</option></select></label>
                        <label class="field"><span>First name</span><input type="text" id="kpi-first" maxlength="60" autocomplete="off" required></label>
                        <label class="field"><span>Last name</span><input type="text" id="kpi-last" maxlength="60" autocomplete="off" required></label>
                        <label class="field"><span>Level</span><select id="kpi-level"><option>L1</option><option>L2</option><option>L3</option><option>L4</option><option>L5</option></select></label>
                        <label class="field"><span>Role / Title</span><input type="text" id="kpi-role" maxlength="80" autocomplete="off" placeholder="e.g. PPC Analyst"></label>
                        <label class="field"><span>Manager (ClickUp user)</span><select id="kpi-manager"><option value="">—</option></select></label>
                        <div class="field kpi-name-box"><span>Scorecard name</span>
                            <div class="kpi-name-row"><code id="kpi-name">KPI-…</code><button type="button" class="button-secondary" id="kpi-copy-name">Copy</button></div>
                        </div>
                    </div>
                    <p class="kpi-hint" id="kpi-users-note"></p>
                    <p class="kpi-hint" id="kpi-source-note"></p>

                    <div class="table-scroll">
                        <table class="entries-table kpi-table">
                            <thead><tr><th>#</th><th>KPI</th><th>Weight %</th><th>Target</th><th>Direction</th><th>Actual</th><th>Score %</th><th>Source / tool</th></tr></thead>
                            <tbody id="kpi-rows"></tbody>
                        </table>
                    </div>
                    <div class="kpi-actions-row">
                        <button type="button" class="button-secondary" id="kpi-add">+ Add KPI</button>
                        <button type="button" class="button-secondary" id="kpi-reset">Reset to defaults and dashboard</button>
                    </div>

                    <div class="kpi-summary" aria-live="polite">
                        <div><span>Overall KPI score %</span><strong id="kpi-overall">—</strong><small id="kpi-coverage"></small></div>
                        <div><span>Weights total</span><strong id="kpi-weights">—</strong><small>must be 100</small></div>
                        <label class="field"><span>Billable %</span><input type="text" inputmode="decimal" id="kpi-billable" maxlength="10" autocomplete="off"></label>
                        <div><span>Performance zone</span><strong id="kpi-zone">—</strong><small id="kpi-zone-note"></small></div>
                    </div>

                    <label class="kpi-check"><input type="checkbox" id="kpi-provisional"> <span>Provisional data (leaves the Performance Zone blank and adds the warning to the description)</span></label>
                    <label class="field kpi-notes"><span>Provisional note / comments (optional)</span><textarea id="kpi-notes" rows="3" maxlength="1500"></textarea></label>

                    <details class="kpi-preview">
                        <summary>Description preview (sent as the task description)</summary>
                        <pre id="kpi-description"></pre>
                        <button type="button" class="button-secondary" id="kpi-copy-desc">Copy description</button>
                    </details>

                    <p class="form-error" id="kpi-error" role="alert" hidden></p>
                    <p class="manual-input-status" id="kpi-status" data-tone="muted" aria-live="polite"></p>
                    <div class="modal-actions kpi-submit-row">
                        <button type="button" class="button-secondary" id="kpi-copy-json">Copy JSON</button>
                        <button type="submit" class="button-primary" id="kpi-save">Save scorecard</button>
                    </div>
                </form>

                <div class="panel kpi-saved">
                    <div class="panel-header"><h3>Saved scorecards</h3><span class="panel-meta" id="kpi-saved-count"></span></div>
                    <div class="table-scroll">
                        <table class="entries-table kpi-saved-table">
                            <thead><tr><th>Name</th><th>Employee</th><th>Score</th><th>Updated</th><th></th></tr></thead>
                            <tbody id="kpi-saved-rows"></tbody>
                        </table>
                    </div>
                    <p class="table-empty is-hidden" id="kpi-saved-empty">No scorecards saved yet.</p>
                </div>
            </section>
