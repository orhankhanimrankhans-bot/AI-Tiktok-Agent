"""Shared accessible dark dialogs for Jarvis Control Center."""
from __future__ import annotations
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication,QDialog,QFileDialog,QMessageBox,QPushButton,QWidget

DIALOG_STYLESHEET = """
QDialog, QMessageBox {
    background-color: #0F151B;
    color: #F1F5F8;
}
QDialog QLabel, QMessageBox QLabel {
    color: #F1F5F8;
    background: transparent;
    font-size: 13px;
}
QMessageBox QLabel#qt_msgbox_label {
    min-width: 320px;
    padding: 8px 4px;
}
QDialog QPushButton, QMessageBox QPushButton {
    min-width: 90px;
    min-height: 30px;
    color: #EAF4F8;
    background: #1C2A33;
    border: 1px solid #365363;
    border-radius: 6px;
    padding: 5px 14px;
}
QDialog QPushButton:hover, QMessageBox QPushButton:hover {
    border-color: #23D7FF;
    background: #213745;
}
QDialog QPushButton:pressed, QMessageBox QPushButton:pressed {
    background: #102B39;
}
QDialog QPushButton:default, QMessageBox QPushButton:default {
    border: 1px solid #23D7FF;
    background: #153847;
}
QDialog QPushButton:disabled, QMessageBox QPushButton:disabled {
    color: #6F7C84;
    background: #151D24;
    border-color: #273842;
}
QPushButton#jarvisDangerButton {
    color: #FFB7B7;
    background: #3A1719;
    border: 1px solid #B84848;
}
QPushButton#jarvisDangerButton:hover {
    color: #FFE2E2;
    background: #562024;
    border-color: #FF5C5C;
}
QFileDialog, QFileDialog QWidget {
    background-color: #0F151B;
    color: #F1F5F8;
}
QFileDialog QLineEdit, QFileDialog QComboBox, QFileDialog QListView, QFileDialog QTreeView {
    color: #F1F5F8;
    background: #151D24;
    border: 1px solid #2B4554;
    selection-background-color: #17485A;
    selection-color: #FFFFFF;
}
"""

class JarvisDialogStyle:
    @staticmethod
    def apply(dialog: QWidget) -> None:
        dialog.setAttribute(Qt.WidgetAttribute.WA_StyledBackground,True)
        existing=dialog.styleSheet()
        if DIALOG_STYLESHEET not in existing:
            dialog.setStyleSheet(existing+"\n"+DIALOG_STYLESHEET)

    @staticmethod
    def install(application: QApplication) -> None:
        existing=application.styleSheet()
        if DIALOG_STYLESHEET not in existing:
            application.setStyleSheet(existing+"\n"+DIALOG_STYLESHEET)

def create_confirmation_box(parent,title,message,confirm_text="Confirm",cancel_text="Cancel",destructive=False,icon=QMessageBox.Icon.Warning):
    box=QMessageBox(parent); box.setWindowTitle(title); box.setIcon(icon); box.setText(message)
    box.setStandardButtons(QMessageBox.StandardButton.Yes|QMessageBox.StandardButton.Cancel)
    confirm=box.button(QMessageBox.StandardButton.Yes); cancel=box.button(QMessageBox.StandardButton.Cancel)
    confirm.setText(confirm_text); cancel.setText(cancel_text); confirm.setDefault(True)
    confirm.setObjectName("jarvisDangerButton" if destructive else "jarvisConfirmButton")
    JarvisDialogStyle.apply(box)
    return box

def show_confirmation(parent,title,message,confirm_text="Confirm",cancel_text="Cancel",destructive=False) -> bool:
    box=create_confirmation_box(parent,title,message,confirm_text,cancel_text,destructive)
    return box.exec()==QMessageBox.StandardButton.Yes

def show_message(parent,title,message,level="information",details="") -> None:
    icons={"information":QMessageBox.Icon.Information,"warning":QMessageBox.Icon.Warning,"critical":QMessageBox.Icon.Critical}
    box=QMessageBox(parent); box.setWindowTitle(title); box.setIcon(icons.get(level,QMessageBox.Icon.Information)); box.setText(message)
    if details: box.setDetailedText(details)
    box.setStandardButtons(QMessageBox.StandardButton.Ok); JarvisDialogStyle.apply(box); box.exec()

def get_open_file_name(parent,title,directory="",file_filter=""):
    dialog=QFileDialog(parent,title,directory,file_filter); dialog.setOption(QFileDialog.Option.DontUseNativeDialog,True); dialog.setFileMode(QFileDialog.FileMode.ExistingFile)
    JarvisDialogStyle.apply(dialog)
    if dialog.exec()!=QDialog.DialogCode.Accepted: return "",""
    files=dialog.selectedFiles(); return (files[0] if files else ""),dialog.selectedNameFilter()
