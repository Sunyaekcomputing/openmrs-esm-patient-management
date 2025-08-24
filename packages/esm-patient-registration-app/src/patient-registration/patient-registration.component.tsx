import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Button, InlineLoading, Link } from '@carbon/react';
import { XAxis } from '@carbon/react/icons';
import { useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Form, Formik, type FormikHelpers } from 'formik';
import {
  createErrorHandler,
  interpolateUrl,
  showSnackbar,
  useConfig,
  usePatient,
  usePatientPhoto,
} from '@openmrs/esm-framework';
import { builtInSections, type RegistrationConfig, type SectionDefinition } from '../config-schema';
import { cancelRegistration, filterOutUndefinedPatientIdentifiers, scrollIntoView } from './patient-registration-utils';
import { getValidationSchema } from './validation/patient-registration-validation';
import { DummyDataInput } from './input/dummy-data/dummy-data-input.component';
import { PatientRegistrationContextProvider } from './patient-registration-context';
import { useResourcesContext } from '../resources-context';
import { SectionWrapper } from './section/section-wrapper.component';
import { type CapturePhotoProps, type FormValues } from './patient-registration.types';
import { type SavePatientForm, SavePatientTransactionManager } from './form-manager';
import { useInitialAddressFieldValues, useInitialFormValues, usePatientUuidMap } from './patient-registration-hooks';
import BeforeSavePrompt from './before-save-prompt';
import styles from './patient-registration.scss';
import { launchWorkspace } from '@openmrs/esm-framework';
import { formEntryWorkspace } from '@openmrs/esm-patient-common-lib';
import { WorkspaceContainer } from '@openmrs/esm-framework';
// import { launchPatientWorkspace } from "@openmrs/esm-patient-common-lib";



<div className={styles.formContainer}>
  <div className={styles.leftColumn}>
    {/* your registration form sections */}
  </div>

  <div className={styles.rightColumn}>
    {/* Workspace slot for clinical forms */}
    <WorkspaceContainer
      contextKey="patient-registration"
      overlay={false}
      showSiderailAndBottomNav={false}
    />
  </div>
</div>


// import { navigate } from '@openmrs/esm-framework';
// import { useNavigate } from 'react-router-dom';
// const navigate = useNavigate();

let exportedInitialFormValuesForTesting = {} as FormValues;

export interface PatientRegistrationProps {
  savePatientForm: SavePatientForm;
  isOffline: boolean;
}

export const PatientRegistration: React.FC<PatientRegistrationProps> = ({ savePatientForm, isOffline }) => {
  const { t } = useTranslation();
  const { currentSession, identifierTypes } = useResourcesContext();
  const { patientUuid: uuidOfPatientToEdit } = useParams();
  const { search } = useLocation();
  const { isLoading: isLoadingPatientToEdit, patient: patientToEdit } = usePatient(uuidOfPatientToEdit);
  const config = useConfig<RegistrationConfig>();

  const [initialFormValues, setInitialFormValues] = useInitialFormValues(
    isLoadingPatientToEdit,
    patientToEdit,
    uuidOfPatientToEdit,
  );
  const [initialAddressFieldValues] = useInitialAddressFieldValues(
    {},
    isLoadingPatientToEdit,
    patientToEdit,
    uuidOfPatientToEdit,
  );

  const [patientUuidMap] = usePatientUuidMap({}, isLoadingPatientToEdit, patientToEdit, uuidOfPatientToEdit);

  const [target, setTarget] = useState<undefined | string>();
  const [capturePhotoProps, setCapturePhotoProps] = useState<CapturePhotoProps | null>(null);

  const location = currentSession?.sessionLocation?.uuid;
  const inEditMode = isLoadingPatientToEdit ? undefined : !!(uuidOfPatientToEdit && patientToEdit);
  const showDummyData = useMemo(() => localStorage.getItem('openmrs:devtools') === 'true' && !inEditMode, [inEditMode]);
  const { data: photo } = usePatientPhoto(patientToEdit?.id);
  const savePatientTransactionManager = useRef(new SavePatientTransactionManager());
  const validationSchema = getValidationSchema(config, t);

  useEffect(() => {
    exportedInitialFormValuesForTesting = initialFormValues;
  }, [initialFormValues]);

  const sections: Array<SectionDefinition> = useMemo(() => {
    return config.sections
      .map(
        (sectionName) =>
          config.sectionDefinitions.filter((s) => s.id == sectionName)[0] ??
          builtInSections.filter((s) => s.id == sectionName)[0],
      )
      .filter((s) => s);
  }, [config.sections, config.sectionDefinitions]);

  const onFormSubmit = async (values: FormValues, helpers: FormikHelpers<FormValues>) => {
    const abortController = new AbortController();
    helpers.setSubmitting(true);
  
    const updatedFormValues = {
      ...values,
      identifiers: filterOutUndefinedPatientIdentifiers(values.identifiers),
    };
  
    // Ensure required fields have defaults
    if (!updatedFormValues.gender || updatedFormValues.gender.trim() === '') {
      updatedFormValues.gender = 'unknown';
    }
    if (!updatedFormValues.givenName || updatedFormValues.givenName.trim() === '') {
      updatedFormValues.givenName = 'unknown';
    }
    if (!updatedFormValues.familyName || updatedFormValues.familyName.trim() === '') {
      updatedFormValues.familyName = 'unknown';
    }
    if (!updatedFormValues.birthdate) {
      updatedFormValues.birthdateEstimated = true;
    }
  
    try {
      const patientUuid = await savePatientForm(
        !inEditMode,
        updatedFormValues,
        patientUuidMap,
        initialAddressFieldValues,
        capturePhotoProps,
        location,
        initialFormValues['identifiers'],
        currentSession,
        config,
        savePatientTransactionManager.current,
        abortController,
      );
  
      showSnackbar({
        subtitle: inEditMode
          ? t('updatePatientSuccessSnackbarSubtitle', "The patient's information has been successfully updated")
          : t('registerPatientSuccessSnackbarSubtitle', 'The patient can now be found by searching for them using their name or ID number'),
        title: inEditMode
          ? t('updatePatientSuccessSnackbarTitle', 'Patient Details Updated')
          : t('registerPatientSuccessSnackbarTitle', 'New Patient Created'),
        kind: 'success',
        isLowContrast: true,
      });
  
      const afterUrl = new URLSearchParams(search).get('afterUrl');
      const redirectUrl = interpolateUrl(afterUrl || config.links.submitButton, { patientUuid: values.patientUuid });
      setTarget(redirectUrl);
  
      helpers.setSubmitting(false);
      return patientUuid; // ✅ important: return UUID for launching the form
    } catch (error) {
      helpers.setSubmitting(false);
      if (error.responseBody?.error?.globalErrors) {
        error.responseBody.error.globalErrors.forEach((error) => {
          showSnackbar({
            title: inEditMode ? t('updatePatientErrorSnackbarTitle', 'Patient Details Update Failed') : t('registrationErrorSnackbarTitle', 'Patient Registration Failed'),
            subtitle: error.message,
            kind: 'error',
          });
        });
      } else if (error.responseBody?.error?.message) {
        showSnackbar({
          title: inEditMode ? t('updatePatientErrorSnackbarTitle', 'Patient Details Update Failed') : t('registrationErrorSnackbarTitle', 'Patient Registration Failed'),
          subtitle: error.responseBody.error.message,
          kind: 'error',
        });
      } else {
        createErrorHandler()(error);
      }
      return undefined;
    }
  };
  
  

  // const displayErrors = (errors) => {
  //   if (errors && typeof errors === 'object' && !!Object.keys(errors).length) {
  //     showSnackbar({
  //       isLowContrast: true,
  //       kind: 'warning',
  //       title: t('fieldsWithErrors', 'The following fields have errors:'),
  //       subtitle: <>{getDescription(errors)}</>,
  //     });
  //   }
  // };


  const fetchSingleClinicalForm = async (): Promise<{ uuid: string; name: string }> => {
    try {
      const response = await fetch('/openmrs/ws/rest/v1/form?limit=1&v=full&q=सहभागी फारम', {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to fetch form');
  
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        console.log('Fetched clinical form:', data.results[0]);
        return data.results[0];
      } else {
        throw new Error('No forms found');
      }
    } catch (error) {
      console.error('Error fetching clinical form:', error);
      throw error;
    }
  };
  
  const createContextValue = useCallback(
    (formikProps) => ({
      identifierTypes,
      validationSchema,
      values: formikProps.values,
      inEditMode,
      setFieldValue: formikProps.setFieldValue,
      setFieldTouched: formikProps.setFieldTouched,
      setCapturePhotoProps,
      currentPhoto: photo?.imageSrc,
      isOffline,
      initialFormValues: formikProps.initialValues,
      setInitialFormValues,
    }),
    [
      identifierTypes,
      validationSchema,
      inEditMode,
      setCapturePhotoProps,
      photo?.imageSrc,
      isOffline,
      setInitialFormValues,
    ],
  );
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [launchFormAfterReady, setLaunchFormAfterReady] = useState(false);
const [pendingPatientUuid, setPendingPatientUuid] = useState<string | null>(null);
useEffect(() => {
  if (launchFormAfterReady && pendingPatientUuid) {
    const launchForm = async () => {
      try {
        // Optional: wait a little to ensure WorkspaceContainer is mounted
        await new Promise((resolve) => setTimeout(resolve, 4000));

        // Fetch the clinical form
        const form = await fetchSingleClinicalForm();
        if (!form?.uuid) {
          console.error("Clinical form UUID not found");
          return;
        }

        // Launch the workspace
        await launchWorkspace(formEntryWorkspace, {
          workspaceTitle: "सहभागी फारम",
          formInfo: {
            patientUuid: pendingPatientUuid,
            formUuid: '30413aeb-e448-46c3-b2c1-52e19233906f',
            encounterUuid: undefined,
            visitUuid: undefined,
            visitTypeUuid: undefined,
            visitStartDatetime: undefined,
            visitStopDatetime: undefined,
            htmlForm: null,
          },
        });

        console.log("Clinical form launched successfully");
      } catch (error) {
        console.error("Error launching clinical form:", error);
      } finally {
        // Reset state after launching
        setLaunchFormAfterReady(false);
        setPendingPatientUuid(null);
      }
    };

    launchForm();
  }
}, [launchFormAfterReady, pendingPatientUuid]);


  

  return (
    <Formik
      enableReinitialize
      initialValues={initialFormValues}
      onSubmit={onFormSubmit}
      validationSchema={validationSchema}
    >
      {(props) => (
        <Form className={styles.form}>
          <BeforeSavePrompt
            when={Object.keys(props.touched).length > 0}
            redirect={target}
          />

          <div className={styles.formContainer}>
            <div>
              <div className={styles.stickyColumn}>
                {showDummyData && <DummyDataInput setValues={props.setValues} />}

                {sections.map((section) => (
                  <div
                    className={classNames(styles.space05, styles.touchTarget)}
                    key={section.name}
                  >
                    <Link
                      className={styles.linkName}
                      onClick={() => scrollIntoView(section.id)}
                    ></Link>
                  </div>
                ))}

                <div>
                  {/* Submit Button triggers consent modal */}
                            <Button
            className={`${styles.commonButtonSize} ${styles.submitButton}`}
            type="button"
            onClick={() => setShowSubmitConfirm(true)}
            disabled={!currentSession || !identifierTypes || props.isSubmitting}
          >
            {props.isSubmitting ? (
              <>
                <span className={styles.spinner} /> {/* or a Spinner component */}
                {t('पर्खनुहोस्', 'पर्खनुहोस्...')}
              </>
            ) : (
              inEditMode
                ? t('updatePatient', 'Update patient')
                : t('registerPatient', 'Register')
            )}
          </Button>
                  {/* Cancel Button triggers cancel confirmation modal */}
                  <Button
                    className={`${styles.commonButtonSize} ${styles.cancelButton}`}
                    kind="secondary"
                    onClick={() => setShowCancelConfirm(true)}
                  >
                    रद्द गर्नुहोस्
                  </Button>
                </div>
              </div>
            </div>

            <div className={styles.infoGrid}>
              <PatientRegistrationContextProvider value={createContextValue(props)}>
                {sections.map((section, index) => (
                  <SectionWrapper
                    key={`registration-section-${section.id}`}
                    sectionDefinition={section}
                    index={index}
                  />
                ))}
              </PatientRegistrationContextProvider>
            </div>
          </div>

          {/* Submit Confirmation Modal */}
          {showSubmitConfirm && (
        <div className={styles.modalOverlay}>
        <div
          className={styles.modalContent}
          style={{
            width: '90%',        // Increase width (max 100%)
            maxWidth: '1200px',  // Optional: cap the width
            padding: '2rem',     // Add some padding inside
          }}
        >
          <h3 style={{ fontSize: '50px', fontWeight: 'bold', color: '#002244' }}>नमस्ते!</h3>
          <p style={{ fontSize: '36px', fontWeight: 'bold', lineHeight: '1.6', color: '#002244' }}>
            नमस्ते! यस अध्ययनमा सहभागी हुन सहमत हुनुभएकोमा धन्यवाद। यस फारममा एचआईभी संक्रमित व्यक्तिहरूले भोग्ने विभिन्न अनुभवहरु राखिएका छन्। यस अध्ययनको उद्देश्य, एचआईभी संक्रमित व्यक्तिहरूले भोग्ने विभिन्न प्रकारका लाञ्छनाहरु पहिचान गरि, त्यसलाई कम गर्न र स्वास्थ्य सेवाको अनुभव सुधार गर्ने हो।   तपाईको सहभागिता यस अध्ययनको लागि एकदमै महत्वपूर्ण रहनेछ।  तपाईले दिनुभएका उत्तरहरूले एआरटी केन्द्रमा दिने सेवालाई राम्रो बनाउन र तपाईले भोग्नुभएका अप्ठ्याराहरुलाई कम गर्न सहयोग पुर्‍याउनेछ। यस प्रक्रियाको लागि १५ देखि २० मिनेटको समय लाग्नेछ। 
            <br /><br />
            तपाईले दिनुभएको जानकारी गोप्य राखिनेछ। तपाईको नाम वा व्यक्तिगत विवरण समावेश गरिने छैन। यो जानकारी अध्ययन गर्ने केही सिमित व्यक्तिहरुले मात्रै हेर्न पाउनेछन्।
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      
          {/* <div className={styles.rightColumn}>
  <WorkspaceContainer
    contextKey="patient-registration"
    showSiderailAndBottomNav={tr}
    additionalWorkspaceProps={{ patientUuid: props.values.patientUuid }}
  />
</div> */}


         
         
{/* 511f754c-ea41-4174-9693-03e96fadbc17 */}

<Button
  className={`${styles.commonButtonSize} ${styles.submitButton}`}
  type="button"
  onClick={async () => {
    if (props.isSubmitting) return; // prevent double click
    setShowSubmitConfirm(false); // close modal
    try {
      // 1️⃣ Submit patient registration form
      const patientUuid = await onFormSubmit(props.values, props);
      if (!patientUuid) {
        console.error("Patient UUID not available");
        return;
      }

      // 2️⃣ Store patient UUID and trigger workspace launch after container is ready
      setPendingPatientUuid(patientUuid);
      setLaunchFormAfterReady(true);
    } catch (error) {
      console.error("Error during registration:", error);
    }
  }}
>
  फारम भर्नुहोस्
</Button>
  


  <Button
    className={`${styles.commonButtonSize} ${styles.cancelButton}`}
    type="button"
    onClick={() => {
      console.log('Clicked रद्द गर्नुहोस् button');
      setShowSubmitConfirm(false); // just close modal
    }}
  >
    रद्द गर्नुहोस्
  </Button>
</div>







              

              </div>
            </div>
          )}

          {/* Cancel Confirmation Modal */}
          {showCancelConfirm && (
            <div className={styles.modalOverlay}>
              <div className={styles.modalContent}>
              <h3>के तपाईं यी परिवर्तनहरू रद्द गर्न चाहनुहुन्छ?</h3>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <Button
                    className={`${styles.commonButtonSize} ${styles.submitButton}`}
                    onClick={() => {
                      setShowCancelConfirm(false);
                      cancelRegistration(); // discard changes
                    }}
                  >
                    चाहन्छु
                  </Button>

                  <Button
                    className={`${styles.commonButtonSize} ${styles.cancelButton}`}
                    onClick={() => setShowCancelConfirm(false)}
                  >
                    चाहन्न
                  </Button>
                  </div>
              </div>
            </div>
          )}
        </Form>
      )}
    </Formik>
  );
};

export { exportedInitialFormValuesForTesting as initialFormValues };