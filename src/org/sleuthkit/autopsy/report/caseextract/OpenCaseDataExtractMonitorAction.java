package org.sleuthkit.autopsy.report.caseextract;

import java.awt.event.ActionEvent;
import javax.swing.AbstractAction;
import javax.swing.Action;
import org.openide.util.NbBundle;
import org.openide.windows.WindowManager;

/**
 * Menu action to open the Case Data Extract Status window.
 */
@NbBundle.Messages({"OpenCaseDataExtractMonitorAction.name=Case Data Extract Status"})
public final class OpenCaseDataExtractMonitorAction extends AbstractAction {

    public OpenCaseDataExtractMonitorAction() {
        putValue(Action.NAME, NbBundle.getMessage(OpenCaseDataExtractMonitorAction.class, "OpenCaseDataExtractMonitorAction.name"));
    }

    @Override
    public void actionPerformed(ActionEvent e) {
        org.openide.windows.TopComponent tc = WindowManager.getDefault().findTopComponent("CaseDataExtractMonitorTopComponent");
        if (tc == null) {
            tc = new CaseDataExtractMonitorTopComponent();
        }
        tc.open();
        tc.requestActive();
    }
}
