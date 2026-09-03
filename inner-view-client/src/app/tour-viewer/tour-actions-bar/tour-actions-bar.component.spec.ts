import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { provideTranslateService } from '@ngx-translate/core';
import { TourActionsBarComponent } from './tour-actions-bar.component';

describe('TourActionsBarComponent', () => {
  let fixture: ComponentFixture<TourActionsBarComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideIonicAngular(),
        provideTranslateService({ lang: 'pt', fallbackLang: 'pt' }),
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  function render(canEdit: boolean, hasScenes: boolean, chromeVisible = true) {
    fixture = TestBed.createComponent(TourActionsBarComponent);
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.componentRef.setInput('hasScenes', hasScenes);
    fixture.componentRef.setInput('chromeVisible', chromeVisible);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('mostra as três ações com alvos reais de 56px no estado padrão', () => {
    const host = render(true, true);
    const buttons = Array.from(host.querySelectorAll('button')) as HTMLButtonElement[];

    expect(buttons.length).toBe(3);
    expect(buttons.every((button) => getComputedStyle(button).height === '56px')).toBeTrue();
  });

  it('sem permissão de edição mostra somente incorporar', () => {
    const host = render(false, true);

    expect(host.querySelector('.tv-actions__button--edit')).toBeNull();
    expect(host.querySelector('.tv-actions__button--embed')).not.toBeNull();
    expect(host.querySelector('.tv-actions__button--delete')).toBeNull();
    expect(host.querySelectorAll('button').length).toBe(1);
  });

  it('sem cenas mostra editar e apagar, escondendo incorporar', () => {
    const host = render(true, false);

    expect(host.querySelector('.tv-actions__button--edit')).not.toBeNull();
    expect(host.querySelector('.tv-actions__button--embed')).toBeNull();
    expect(host.querySelector('.tv-actions__button--delete')).not.toBeNull();
    expect(host.querySelectorAll('button').length).toBe(2);
    expect(Array.from(host.querySelectorAll('button')).every((button) => !button.disabled))
      .toBeTrue();
  });

  it('emite intenções sem executar ações do tour', () => {
    const host = render(true, true);
    const component = fixture.componentInstance;
    const edit = spyOn(component.editRequested, 'emit');
    const embed = spyOn(component.embedRequested, 'emit');
    const remove = spyOn(component.deleteRequested, 'emit');

    (host.querySelector('.tv-actions__button--edit') as HTMLButtonElement).click();
    (host.querySelector('.tv-actions__button--embed') as HTMLButtonElement).click();
    (host.querySelector('.tv-actions__button--delete') as HTMLButtonElement).click();

    expect(edit).toHaveBeenCalledOnceWith();
    expect(embed).toHaveBeenCalledOnceWith();
    expect(remove).toHaveBeenCalledOnceWith();
  });

  it('sai do caminho do panorama quando o chrome está oculto', () => {
    render(true, true, false);

    expect(fixture.nativeElement.classList).toContain('is-hidden');
    expect(getComputedStyle(fixture.nativeElement).pointerEvents).toBe('none');
  });
});
